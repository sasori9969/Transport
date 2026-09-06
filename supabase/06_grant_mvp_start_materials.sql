-- Gibt bestehenden Unternehmen einmalig die Rohstoffe für eine Startproduktion.
-- Die Mengen entsprechen exakt einem Holzdeko-Rezept.
-- Vorhandene Materialbestände werden nicht verändert.

BEGIN;

INSERT INTO public.player_materials (
    company_id,
    material_id,
    quantity,
    average_cost
)
SELECT
    company.id,
    material.id,
    CASE material.name
        WHEN 'Holz' THEN 2.00
        WHEN 'Farbe' THEN 0.20
        WHEN 'Leim' THEN 0.10
        WHEN 'Verpackung' THEN 0.10
    END,
    0
FROM public.companies AS company
JOIN public.materials AS material
    ON material.name IN ('Holz', 'Farbe', 'Leim', 'Verpackung')
WHERE NOT EXISTS (
    SELECT 1
    FROM public.player_materials AS existing_material
    WHERE existing_material.company_id = company.id
      AND existing_material.material_id = material.id
);

COMMIT;
