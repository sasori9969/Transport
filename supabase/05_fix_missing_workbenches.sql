-- Ergänzt fehlende kostenlose Werkbänke für bestehende Unternehmen.
-- Dieses Skript ist idempotent und verändert vorhandene Maschinen nicht.

BEGIN;

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
SELECT
    company.id,
    location.id,
    machine_type.id,
    'Meine Werkbank',
    1,
    100,
    1,
    0,
    'idle'
FROM public.companies AS company
JOIN public.locations AS location
    ON location.company_id = company.id
JOIN public.machine_types AS machine_type
    ON machine_type.purchase_price = 0
   AND lower(machine_type.name) = 'kostenlose werkbank'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.machines AS existing_machine
    WHERE existing_machine.company_id = company.id
      AND existing_machine.machine_type_id = machine_type.id
);

COMMIT;
