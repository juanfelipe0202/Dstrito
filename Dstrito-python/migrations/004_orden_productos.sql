ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

WITH ranked_products AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY category
            ORDER BY created_at DESC, id DESC
        ) - 1 AS position
    FROM public.products
)
UPDATE public.products AS products
SET sort_order = ranked_products.position
FROM ranked_products
WHERE products.id = ranked_products.id;

CREATE INDEX IF NOT EXISTS products_category_sort_order_idx
    ON public.products (category, sort_order);
