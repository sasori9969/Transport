-- ============================================================
-- EMPIRE TYCOON
-- 10 – Produktabhängige Nachfrage und Verkaufsdauer
-- ============================================================
--
-- Die Angebotsdauer wird nicht mehr vom Spieler gewählt. Jedes
-- Produkt erhält eine natürliche Nachfrage und eine Grundverkaufszeit.
-- Der tatsächliche Verkauf wird durch Preis und Marktsättigung verändert.
--
-- Formel:
--   erwartete Verkaufszeit =
--   Grundverkaufszeit × Preisfaktor × Sättigungsfaktor
--
-- Die Werte sind bewusst unabhängig vom absoluten Preis. Dadurch kann
-- eine Holzdeko in wenigen Minuten verkauft werden, während ein Auto
-- bei gleichem Marktprinzip deutlich länger benötigt.
-- ============================================================

BEGIN;

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS market_demand_per_hour numeric(14, 2)
        NOT NULL DEFAULT 60,
    ADD COLUMN IF NOT EXISTS market_base_sale_minutes numeric(14, 2)
        NOT NULL DEFAULT 30;

-- Sinnvolle Startwerte aus dem Produktwert ableiten. Diese Werte können
-- später pro Produktbalancing angepasst werden.
UPDATE public.products
   SET market_demand_per_hour = CASE
           WHEN COALESCE(base_price, 0) <= 20 THEN 120
           WHEN COALESCE(base_price, 0) <= 1000 THEN 20
           ELSE 4
       END,
       market_base_sale_minutes = CASE
           WHEN COALESCE(base_price, 0) <= 20 THEN 3
           WHEN COALESCE(base_price, 0) <= 1000 THEN 15
           ELSE 90
       END
 WHERE market_base_sale_minutes = 30
    OR market_demand_per_hour = 60;

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

        -- Preis und Sättigung wirken für alle Produktarten nach derselben
        -- Regel. Nur die natürliche Nachfrage des Produkts unterscheidet sich.
        v_price_factor := power(
            GREATEST(v_listing.price_per_unit / v_market_price, 0.05),
            2
        );
        v_saturation_factor := 1 + (
            v_active_supply / v_demand_per_hour
        );
        v_expected_minutes := GREATEST(
            v_base_sale_minutes
            * v_price_factor
            * v_saturation_factor,
            0.5
        );

        -- Die Funktion wird normalerweise alle 30 Sekunden aufgerufen.
        -- Die Verkaufswahrscheinlichkeit leitet sich ausschließlich aus
        -- der erwarteten Verkaufszeit ab.
        v_sell_probability := LEAST(
            GREATEST(0.5 / v_expected_minutes, 0.001),
            0.95
        );

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

GRANT EXECUTE ON FUNCTION public.process_market_listings()
    TO authenticated;

REVOKE EXECUTE ON FUNCTION public.process_market_listings()
    FROM anon;

COMMIT;
