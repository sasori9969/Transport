-- ============================================================
-- EMPIRE TYCOON
-- 08 – Rezept für die Holzbearbeitungsmaschine
-- ============================================================
--
-- Die Holzbearbeitungsmaschine wird mit einem passenden
-- Holzdeko-Rezept produktiv nutzbar. Das Skript ist idempotent:
-- bei erneutem Ausführen werden weder Rezept noch Zutaten doppelt
-- angelegt.
--
-- Voraussetzung: Die Stammdaten für Maschine, Produkt und
-- Materialien wurden bereits angelegt.
-- ============================================================

BEGIN;

DO $$
DECLARE
    v_machine_type_id uuid;
    v_product_id uuid;
    v_recipe_id uuid;
    v_material_id uuid;
BEGIN
    SELECT id
      INTO v_machine_type_id
      FROM public.machine_types
     WHERE lower(trim(name)) = 'holzbearbeitungsmaschine'
     LIMIT 1;

    SELECT id
      INTO v_product_id
      FROM public.products
     WHERE lower(trim(name)) = 'holzdeko'
     LIMIT 1;

    IF v_machine_type_id IS NULL THEN
        RAISE EXCEPTION 'Machine type "Holzbearbeitungsmaschine" not found';
    END IF;

    IF v_product_id IS NULL THEN
        RAISE EXCEPTION 'Product "Holzdeko" not found';
    END IF;

    SELECT id
      INTO v_recipe_id
      FROM public.recipes
     WHERE machine_type_id = v_machine_type_id
       AND product_id = v_product_id
     LIMIT 1;

    IF v_recipe_id IS NULL THEN
        INSERT INTO public.recipes (
            product_id,
            machine_type_id,
            production_time_seconds,
            output_quantity
        )
        VALUES (
            v_product_id,
            v_machine_type_id,
            60,
            1
        )
        RETURNING id INTO v_recipe_id;
    END IF;

    -- Holz: 2 Einheiten pro Holzdeko
    SELECT id INTO v_material_id
      FROM public.materials
     WHERE lower(trim(name)) = 'holz'
     LIMIT 1;

    IF v_material_id IS NULL THEN
        RAISE EXCEPTION 'Material "Holz" not found';
    END IF;

    INSERT INTO public.recipe_materials (recipe_id, material_id, quantity)
    SELECT v_recipe_id, v_material_id, 2.00
    WHERE NOT EXISTS (
        SELECT 1
          FROM public.recipe_materials
         WHERE recipe_id = v_recipe_id
           AND material_id = v_material_id
    );

    -- Farbe: 0,2 Einheiten pro Holzdeko
    SELECT id INTO v_material_id
      FROM public.materials
     WHERE lower(trim(name)) = 'farbe'
     LIMIT 1;

    IF v_material_id IS NULL THEN
        RAISE EXCEPTION 'Material "Farbe" not found';
    END IF;

    INSERT INTO public.recipe_materials (recipe_id, material_id, quantity)
    SELECT v_recipe_id, v_material_id, 0.20
    WHERE NOT EXISTS (
        SELECT 1
          FROM public.recipe_materials
         WHERE recipe_id = v_recipe_id
           AND material_id = v_material_id
    );

    -- Leim: 0,1 Einheiten pro Holzdeko
    SELECT id INTO v_material_id
      FROM public.materials
     WHERE lower(trim(name)) = 'leim'
     LIMIT 1;

    IF v_material_id IS NULL THEN
        RAISE EXCEPTION 'Material "Leim" not found';
    END IF;

    INSERT INTO public.recipe_materials (recipe_id, material_id, quantity)
    SELECT v_recipe_id, v_material_id, 0.10
    WHERE NOT EXISTS (
        SELECT 1
          FROM public.recipe_materials
         WHERE recipe_id = v_recipe_id
           AND material_id = v_material_id
    );

    -- Verpackung: 0,1 Einheiten pro Holzdeko
    SELECT id INTO v_material_id
      FROM public.materials
     WHERE lower(trim(name)) = 'verpackung'
     LIMIT 1;

    IF v_material_id IS NULL THEN
        RAISE EXCEPTION 'Material "Verpackung" not found';
    END IF;

    INSERT INTO public.recipe_materials (recipe_id, material_id, quantity)
    SELECT v_recipe_id, v_material_id, 0.10
    WHERE NOT EXISTS (
        SELECT 1
          FROM public.recipe_materials
         WHERE recipe_id = v_recipe_id
           AND material_id = v_material_id
    );
END;
$$;

COMMIT;
