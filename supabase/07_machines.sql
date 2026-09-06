-- ============================================================
-- EMPIRE TYCOON
-- 07 – Maschinen kaufen, verkaufen und reparieren
-- ============================================================
--
-- Stellt drei RPC-Funktionen für das Maschinen-Panel bereit:
--
--   buy_machine(p_company_id, p_machine_type_id, p_name)
--   sell_machine(p_machine_id)
--   repair_machine(p_machine_id)
--
-- Alle Funktionen laufen als SECURITY DEFINER und prüfen selbst,
-- dass der aufrufende Nutzer (auth.uid()) Eigentümer des
-- Unternehmens ist. Das Frontend braucht daher keine
-- INSERT/UPDATE/DELETE-Policies auf public.machines.
--
-- Fehlermeldungen sind bewusst englisch und enthalten
-- Schlüsselwörter (cash, power, machine, ...), die das Frontend
-- in js/machines.js übersetzt.
--
-- Das Skript ist idempotent (CREATE OR REPLACE).
-- ============================================================

BEGIN;


-- ------------------------------------------------------------
-- Spielregeln (an einer Stelle gebündelt)
-- ------------------------------------------------------------
--
--   Verkauf:    Erlös = Kaufpreis × 50 % × Zustand/100
--   Reparatur:  Kosten = Kaufpreis × 30 % × (100 − Zustand)/100
--   Werkbank:   purchase_price = 0 → weder verkaufbar noch
--               reparaturbedürftig (kostenlos, wird auf 100 gesetzt)
--
-- Tipp: Die Faktoren sind unten als Konstanten in den Funktionen
-- hinterlegt (0.50 bzw. 0.30) und lassen sich dort anpassen.


-- ------------------------------------------------------------
-- Hilfsfunktion: Unternehmen auf Eigentum prüfen und sperren
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_company_owner(
    p_company_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_owner_id uuid;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not authenticated'
            USING ERRCODE = '28000';
    END IF;

    SELECT owner_id
      INTO v_owner_id
      FROM public.companies
     WHERE id = p_company_id
       FOR UPDATE;

    IF v_owner_id IS NULL THEN
        RAISE EXCEPTION 'Company not found'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_owner_id <> auth.uid() THEN
        RAISE EXCEPTION 'Company does not belong to the current user'
            USING ERRCODE = '42501';
    END IF;

    RETURN v_owner_id;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_company_owner(uuid) FROM PUBLIC;
-- Nur intern von den RPCs unten genutzt, nicht direkt aufrufbar.


-- ------------------------------------------------------------
-- MASCHINE KAUFEN
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.buy_machine(
    p_company_id uuid,
    p_machine_type_id uuid,
    p_name text DEFAULT NULL
)
RETURNS public.machines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_owner_id uuid;
    v_location public.locations%ROWTYPE;
    v_type public.machine_types%ROWTYPE;
    v_cash numeric;
    v_power_used numeric;
    v_owned_count integer;
    v_name text;
    v_machine public.machines%ROWTYPE;
BEGIN
    v_owner_id := public.assert_company_owner(p_company_id);

    -- Maschinentyp laden
    SELECT *
      INTO v_type
      FROM public.machine_types
     WHERE id = p_machine_type_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Machine type not found'
            USING ERRCODE = 'P0002';
    END IF;

    -- Die kostenlose Werkbank gibt es genau einmal pro Unternehmen
    IF v_type.purchase_price <= 0 THEN
        IF EXISTS (
            SELECT 1
              FROM public.machines
             WHERE company_id = p_company_id
               AND machine_type_id = p_machine_type_id
        ) THEN
            RAISE EXCEPTION 'Free machine already owned'
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- Standort (erster Standort des Unternehmens)
    SELECT *
      INTO v_location
      FROM public.locations
     WHERE company_id = p_company_id
     ORDER BY created_at ASC
     LIMIT 1
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Location not found'
            USING ERRCODE = 'P0002';
    END IF;

    -- Stromkapazität prüfen (alle Maschinen zählen zur Grundlast,
    -- damit man keine Maschine kaufen kann, die man nie betreiben könnte)
    SELECT COALESCE(SUM(mt.power_usage), 0)
      INTO v_power_used
      FROM public.machines m
      JOIN public.machine_types mt ON mt.id = m.machine_type_id
     WHERE m.company_id = p_company_id;

    IF v_power_used + v_type.power_usage > v_location.power_capacity THEN
        RAISE EXCEPTION 'Not enough power capacity at this location'
            USING ERRCODE = 'P0001';
    END IF;

    -- Geld prüfen und abbuchen (Zeile sperren)
    SELECT cash
      INTO v_cash
      FROM public.profiles
     WHERE id = v_owner_id
       FOR UPDATE;

    IF v_cash IS NULL OR v_cash < v_type.purchase_price THEN
        RAISE EXCEPTION 'Not enough cash'
            USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.profiles
       SET cash = cash - v_type.purchase_price
     WHERE id = v_owner_id;

    -- Name: Wunschname oder "<Typ> #n"
    SELECT COUNT(*)
      INTO v_owned_count
      FROM public.machines
     WHERE company_id = p_company_id
       AND machine_type_id = p_machine_type_id;

    v_name := NULLIF(btrim(COALESCE(p_name, '')), '');

    IF v_name IS NULL THEN
        v_name := v_type.name || ' #' || (v_owned_count + 1);
    END IF;

    v_name := left(v_name, 60);

    -- Maschine anlegen
    INSERT INTO public.machines (
        company_id,
        location_id,
        machine_type_id,
        name,
        level,
        condition,
        efficiency,
        quality_bonus,
        status
    )
    VALUES (
        p_company_id,
        v_location.id,
        v_type.id,
        v_name,
        1,
        100,
        COALESCE(v_type.base_speed, 1),
        COALESCE(v_type.base_quality, 0),
        'idle'
    )
    RETURNING * INTO v_machine;

    RETURN v_machine;
END;
$$;


-- ------------------------------------------------------------
-- MASCHINE VERKAUFEN
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sell_machine(
    p_machine_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_machine public.machines%ROWTYPE;
    v_type public.machine_types%ROWTYPE;
    v_owner_id uuid;
    v_payout numeric;
BEGIN
    SELECT *
      INTO v_machine
      FROM public.machines
     WHERE id = p_machine_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Machine not found'
            USING ERRCODE = 'P0002';
    END IF;

    v_owner_id := public.assert_company_owner(v_machine.company_id);

    SELECT *
      INTO v_type
      FROM public.machine_types
     WHERE id = v_machine.machine_type_id;

    -- Die kostenlose Werkbank bleibt immer erhalten
    IF COALESCE(v_type.purchase_price, 0) <= 0 THEN
        RAISE EXCEPTION 'The free workbench cannot be sold'
            USING ERRCODE = 'P0001';
    END IF;

    -- Läuft gerade eine Produktion darauf?
    IF v_machine.status = 'working' OR EXISTS (
        SELECT 1
          FROM public.production_jobs
         WHERE machine_id = v_machine.id
           AND status = 'running'
    ) THEN
        RAISE EXCEPTION 'Machine is busy with a running production'
            USING ERRCODE = 'P0001';
    END IF;

    -- Erlös: 50 % des Kaufpreises, gewichtet mit dem Zustand
    v_payout := round(
        v_type.purchase_price
        * 0.50
        * GREATEST(LEAST(COALESCE(v_machine.condition, 0), 100), 0) / 100,
        2
    );

    DELETE FROM public.machines
     WHERE id = v_machine.id;

    UPDATE public.profiles
       SET cash = cash + v_payout
     WHERE id = v_owner_id;

    RETURN v_payout;
END;
$$;


-- ------------------------------------------------------------
-- MASCHINE REPARIEREN
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.repair_machine(
    p_machine_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_machine public.machines%ROWTYPE;
    v_type public.machine_types%ROWTYPE;
    v_owner_id uuid;
    v_cash numeric;
    v_cost numeric;
    v_condition numeric;
BEGIN
    SELECT *
      INTO v_machine
      FROM public.machines
     WHERE id = p_machine_id
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Machine not found'
            USING ERRCODE = 'P0002';
    END IF;

    v_owner_id := public.assert_company_owner(v_machine.company_id);

    v_condition := GREATEST(LEAST(COALESCE(v_machine.condition, 0), 100), 0);

    IF v_condition >= 100 THEN
        RAISE EXCEPTION 'Machine is already in perfect condition'
            USING ERRCODE = 'P0001';
    END IF;

    IF v_machine.status = 'working' THEN
        RAISE EXCEPTION 'Machine is busy with a running production'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT *
      INTO v_type
      FROM public.machine_types
     WHERE id = v_machine.machine_type_id;

    -- Kosten: 30 % des Kaufpreises, anteilig zum fehlenden Zustand
    v_cost := round(
        COALESCE(v_type.purchase_price, 0)
        * 0.30
        * (100 - v_condition) / 100,
        2
    );

    IF v_cost > 0 THEN
        SELECT cash
          INTO v_cash
          FROM public.profiles
         WHERE id = v_owner_id
           FOR UPDATE;

        IF v_cash IS NULL OR v_cash < v_cost THEN
            RAISE EXCEPTION 'Not enough cash'
                USING ERRCODE = 'P0001';
        END IF;

        UPDATE public.profiles
           SET cash = cash - v_cost
         WHERE id = v_owner_id;
    END IF;

    UPDATE public.machines
       SET condition = 100,
           status = CASE
                        WHEN status IN ('broken', 'maintenance') THEN 'idle'
                        ELSE status
                    END
     WHERE id = v_machine.id;

    RETURN v_cost;
END;
$$;


-- ------------------------------------------------------------
-- Rechte
-- ------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.buy_machine(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sell_machine(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_machine(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.buy_machine(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sell_machine(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.repair_machine(uuid) FROM anon;

COMMIT;
