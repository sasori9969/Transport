-- ============================================================
-- EMPIRE TYCOON
-- 11 – Ganze Artikel und verbindlicher Verkaufszeitpunkt
-- ============================================================
--
-- Ein Produkt wird immer als ganzer Artikel gehandelt.
-- Es gibt keine Teilverkäufe mehr: 0,61 Holzdeko ist unmöglich.
--
-- Ein Angebot erhält beim Einstellen einen berechneten finalizes_at-
-- Zeitpunkt. Bis dahin können einzelne ganze Artikel verkauft werden.
-- Zum finalen Zeitpunkt werden alle verbleibenden Artikel des Angebots
-- gemeinsam verkauft. Dadurch bleibt jedes Angebot endlich.
-- ============================================================

BEGIN;

ALTER TABLE public.market_listings
    ADD COLUMN IF NOT EXISTS finalizes_at timestamptz;

-- Alte Teilmengen werden einmalig auf ganze Artikel aufgerundet.
-- Neue Verkäufe erzeugen danach ausschließlich ganze Einheiten.
UPDATE public.market_listings
   SET quantity = CEIL(quantity),
       remaining_quantity = CEIL(remaining_quantity)
 WHERE quantity <> trunc(quantity)
    OR remaining_quantity <> trunc(remaining_quantity);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'market_listings_whole_quantities'
           AND conrelid = 'public.market_listings'::regclass
    ) THEN
        ALTER TABLE public.market_listings
            ADD CONSTRAINT market_listings_whole_quantities
            CHECK (
                quantity = trunc(quantity)
                AND remaining_quantity = trunc(remaining_quantity)
            );
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_market_listing(
    p_company_id uuid,
    p_product_id uuid,
    p_quantity numeric,
    p_price_per_unit numeric,
    p_duration_minutes integer DEFAULT 1440
)
RETURNS public.market_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_listing public.market_listings%ROWTYPE;
    v_available numeric;
    v_base_price numeric;
    v_market_price numeric;
    v_base_sale_minutes numeric;
    v_expected_minutes numeric;
BEGIN
    PERFORM public.assert_company_owner(p_company_id);

    IF p_quantity IS NULL
       OR p_quantity <= 0
       OR p_quantity <> trunc(p_quantity) THEN
        RAISE EXCEPTION 'Listing quantity must be a whole positive number';
    END IF;

    IF p_price_per_unit IS NULL OR p_price_per_unit <= 0 THEN
        RAISE EXCEPTION 'Listing price must be positive';
    END IF;

    SELECT
        p.base_price,
        COALESCE(mp.current_price, p.base_price),
        COALESCE(p.market_base_sale_minutes, 30)
      INTO
        v_base_price,
        v_market_price,
        v_base_sale_minutes
      FROM public.products AS p
      LEFT JOIN public.market_prices AS mp
        ON mp.product_id = p.id
     WHERE p.id = p_product_id;

    IF v_base_price IS NULL THEN
        RAISE EXCEPTION 'Product not found';
    END IF;

    SELECT quantity
      INTO v_available
      FROM public.storage
     WHERE company_id = p_company_id
       AND product_id = p_product_id
       FOR UPDATE;

    IF COALESCE(v_available, 0) < p_quantity THEN
        RAISE EXCEPTION 'Not enough product quantity in storage';
    END IF;

    -- Der erwartete Zeitpunkt hängt vom Produkt und vom Preis ab,
    -- nicht von einer frei gewählten Laufzeit.
    v_expected_minutes := LEAST(
        GREATEST(
            COALESCE(v_base_sale_minutes, 30)
            * power(
                GREATEST(
                    p_price_per_unit / GREATEST(COALESCE(v_market_price, v_base_price), 0.01),
                    0.05
                ),
                2
            ),
            0.5
        ),
        1440
    );

    UPDATE public.storage
       SET quantity = quantity - p_quantity
     WHERE company_id = p_company_id
       AND product_id = p_product_id;

    INSERT INTO public.market_listings (
        company_id,
        product_id,
        quantity,
        remaining_quantity,
        price_per_unit,
        status,
        expires_at,
        finalizes_at
    )
    VALUES (
        p_company_id,
        p_product_id,
        p_quantity,
        p_quantity,
        round(p_price_per_unit, 2),
        'active',
        now() + make_interval(mins => v_expected_minutes::double precision),
        now() + make_interval(mins => v_expected_minutes::double precision)
    )
    RETURNING * INTO v_listing;

    RETURN v_listing;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_market_listings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_listing public.market_listings%ROWTYPE;
    v_market_price numeric;
    v_base_sale_minutes numeric;
    v_demand_per_hour numeric;
    v_active_supply numeric;
    v_price_factor numeric;
    v_saturation_factor numeric;
    v_expected_minutes numeric;
    v_sell_probability numeric;
    v_sell_quantity numeric;
    v_revenue numeric;
    v_sold_count integer := 0;
    v_is_final boolean;
BEGIN
    FOR v_listing IN
        SELECT *
          FROM public.market_listings
         WHERE status = 'active'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
    LOOP
        v_is_final := now() >= COALESCE(
            v_listing.finalizes_at,
            v_listing.expires_at
        );

        SELECT
            COALESCE(mp.current_price, p.base_price, v_listing.price_per_unit),
            COALESCE(p.market_base_sale_minutes, 30),
            COALESCE(p.market_demand_per_hour, 60)
          INTO
            v_market_price,
            v_base_sale_minutes,
            v_demand_per_hour
          FROM public.products AS p
          LEFT JOIN public.market_prices AS mp
            ON mp.product_id = p.id
         WHERE p.id = v_listing.product_id;

        SELECT COALESCE(SUM(remaining_quantity), 0)
          INTO v_active_supply
          FROM public.market_listings
         WHERE product_id = v_listing.product_id
           AND status = 'active';

        v_market_price := GREATEST(COALESCE(v_market_price, v_listing.price_per_unit), 0.01);
        v_base_sale_minutes := GREATEST(COALESCE(v_base_sale_minutes, 30), 0.5);
        v_demand_per_hour := GREATEST(COALESCE(v_demand_per_hour, 60), 0.01);

        v_price_factor := power(
            GREATEST(v_listing.price_per_unit / v_market_price, 0.05),
            2
        );
        v_saturation_factor := 1 + (v_active_supply / v_demand_per_hour);
        v_expected_minutes := GREATEST(
            v_base_sale_minutes * v_price_factor * v_saturation_factor,
            0.5
        );
        v_sell_probability := LEAST(
            GREATEST(0.5 / v_expected_minutes, 0.001),
            0.95
        );

        IF v_is_final THEN
            -- Der Rest wird am verbindlichen Endzeitpunkt als ganze
            -- Artikel verkauft. Es bleibt kein endloses Angebot offen.
            v_sell_quantity := v_listing.remaining_quantity;
        ELSIF random() <= v_sell_probability THEN
            -- Auch während der Laufzeit werden nur ganze Artikel verkauft.
            v_sell_quantity := GREATEST(
                1,
                floor(v_listing.remaining_quantity * LEAST(v_sell_probability, 0.50))
            );
            v_sell_quantity := LEAST(v_sell_quantity, v_listing.remaining_quantity);
        ELSE
            v_sell_quantity := 0;
        END IF;

        IF v_sell_quantity > 0 THEN
            v_revenue := round(v_sell_quantity * v_listing.price_per_unit, 2);

            UPDATE public.profiles
               SET cash = cash + v_revenue
             WHERE id = (
                 SELECT owner_id
                   FROM public.companies
                  WHERE id = v_listing.company_id
             );

            UPDATE public.market_listings
               SET remaining_quantity = remaining_quantity - v_sell_quantity,
                   total_revenue = total_revenue + v_revenue,
                   status = CASE
                       WHEN remaining_quantity - v_sell_quantity <= 0
                       THEN 'sold'
                       ELSE 'active'
                   END,
                   sold_at = CASE
                       WHEN remaining_quantity - v_sell_quantity <= 0
                       THEN now()
                       ELSE sold_at
                   END
             WHERE id = v_listing.id;

            UPDATE public.market_prices
               SET supply = COALESCE(supply, 0) + v_sell_quantity,
                   current_price = GREATEST(
                       0.01,
                       current_price * (1 - LEAST(v_sell_quantity / 10000, 0.02))
                   )
             WHERE product_id = v_listing.product_id;

            v_sold_count := v_sold_count + 1;
        END IF;
    END LOOP;

    RETURN v_sold_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_market_listing(uuid, uuid, numeric, numeric, integer)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_market_listings()
    TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_market_listing(uuid, uuid, numeric, numeric, integer)
    FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_market_listings()
    FROM anon;

COMMIT;
