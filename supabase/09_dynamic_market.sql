-- ============================================================
-- EMPIRE TYCOON
-- 09 – Zeitbasierter dynamischer Verkaufsmarkt
-- ============================================================
--
-- Produkte werden nicht mehr direkt verkauft. Sie werden als
-- Angebot eingestellt, aus dem Lager reserviert und anschließend
-- schrittweise durch den Markt verkauft.
--
-- Preislogik:
--   günstiger als der Marktpreis = schneller Verkauf
--   teurer als der Marktpreis = langsamer Verkauf
--
-- Die Funktion process_market_listings kann regelmäßig (z. B. alle
-- 30 Sekunden) vom eingeloggten Frontend aufgerufen werden.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.market_listings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES public.products(id),
    quantity numeric(14, 2) NOT NULL CHECK (quantity > 0),
    remaining_quantity numeric(14, 2) NOT NULL CHECK (remaining_quantity >= 0),
    price_per_unit numeric(14, 2) NOT NULL CHECK (price_per_unit > 0),
    status text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'sold', 'expired', 'cancelled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    sold_at timestamptz,
    total_revenue numeric(14, 2) NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS market_listings_active_idx
    ON public.market_listings (status, expires_at);

CREATE INDEX IF NOT EXISTS market_listings_company_idx
    ON public.market_listings (company_id, created_at DESC);

ALTER TABLE public.market_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS market_listings_owner_select
    ON public.market_listings;

CREATE POLICY market_listings_owner_select
    ON public.market_listings
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
              FROM public.companies
             WHERE companies.id = market_listings.company_id
               AND companies.owner_id = auth.uid()
        )
    );

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
BEGIN
    PERFORM public.assert_company_owner(p_company_id);

    IF p_quantity IS NULL OR p_quantity <= 0 THEN
        RAISE EXCEPTION 'Listing quantity must be positive';
    END IF;

    IF p_price_per_unit IS NULL OR p_price_per_unit <= 0 THEN
        RAISE EXCEPTION 'Listing price must be positive';
    END IF;

    IF p_duration_minutes IS NULL
       OR p_duration_minutes < 60
       OR p_duration_minutes > 10080 THEN
        RAISE EXCEPTION 'Listing duration must be between 1 hour and 7 days';
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
        expires_at
    )
    VALUES (
        p_company_id,
        p_product_id,
        p_quantity,
        p_quantity,
        round(p_price_per_unit, 2),
        now() + make_interval(mins => p_duration_minutes)
    )
    RETURNING * INTO v_listing;

    RETURN v_listing;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_market_listing(
    p_listing_id uuid
)
RETURNS public.market_listings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_listing public.market_listings%ROWTYPE;
BEGIN
    SELECT *
      INTO v_listing
      FROM public.market_listings
     WHERE id = p_listing_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Market listing not found';
    END IF;

    PERFORM public.assert_company_owner(v_listing.company_id);

    IF v_listing.status <> 'active' THEN
        RAISE EXCEPTION 'Market listing is no longer active';
    END IF;

    IF v_listing.remaining_quantity > 0 THEN
        INSERT INTO public.storage (company_id, product_id, quantity)
        VALUES (
            v_listing.company_id,
            v_listing.product_id,
            v_listing.remaining_quantity
        )
        ON CONFLICT (company_id, product_id)
        DO UPDATE SET
            quantity = public.storage.quantity + EXCLUDED.quantity;
    END IF;

    UPDATE public.market_listings
       SET status = 'cancelled'
     WHERE id = v_listing.id
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
    v_price_factor numeric;
    v_saturation_factor numeric;
    v_sell_probability numeric;
    v_sell_quantity numeric;
    v_sold_count integer := 0;
    v_revenue numeric;
BEGIN
    FOR v_listing IN
        SELECT *
          FROM public.market_listings
         WHERE status = 'active'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
    LOOP
        IF v_listing.expires_at <= now() THEN
            IF v_listing.remaining_quantity > 0 THEN
                INSERT INTO public.storage (company_id, product_id, quantity)
                VALUES (
                    v_listing.company_id,
                    v_listing.product_id,
                    v_listing.remaining_quantity
                )
                ON CONFLICT (company_id, product_id)
                DO UPDATE SET
                    quantity = public.storage.quantity + EXCLUDED.quantity;
            END IF;

            UPDATE public.market_listings
               SET status = 'expired'
             WHERE id = v_listing.id;

            CONTINUE;
        END IF;

        SELECT current_price
          INTO v_market_price
          FROM public.market_prices
         WHERE product_id = v_listing.product_id
         LIMIT 1;

        v_market_price := GREATEST(COALESCE(v_market_price, v_listing.price_per_unit), 0.01);
        v_price_factor := power(
            GREATEST(v_market_price / v_listing.price_per_unit, 0.05),
            2
        );

        -- Ein Teil des Angebots wird pro Verarbeitungstakt verkauft.
        -- Günstige Angebote verkaufen sich schnell, teure langsam.
        v_sell_probability := LEAST(GREATEST(0.20 * v_price_factor, 0.01), 0.95);

        IF random() <= v_sell_probability THEN
            v_sell_quantity := GREATEST(
                0.01,
                round(v_listing.remaining_quantity * LEAST(v_sell_probability, 0.50), 2)
            );
            v_sell_quantity := LEAST(v_sell_quantity, v_listing.remaining_quantity);
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
GRANT EXECUTE ON FUNCTION public.cancel_market_listing(uuid)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_market_listings()
    TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_market_listing(uuid, uuid, numeric, numeric, integer)
    FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancel_market_listing(uuid)
    FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_market_listings()
    FROM anon;

COMMIT;
