import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import import_lidl_catalog as importer


class LidlCatalogImportTests(unittest.TestCase):
    def test_product_id_and_article_code_are_kept_separate(self):
        data = {
            "productId": 12345,
            "nat": "0083215",
            "ians": ["83215"],
            "fullTitle": "Patata granel",
        }
        common = importer.product_common_fields(data)
        self.assertEqual(common["product_id"], "12345")
        self.assertEqual(common["article_code"], "0083215")

    def test_lidl_plus_price_uses_pack_price_and_reference_unit(self):
        common = {
            "product_id": "12345",
            "article_code": "0083215",
            "product_name": "Patata granel",
            "brand": None,
            "category": "Frutas y hortalizas",
            "description": None,
            "image_url": None,
            "product_url": None,
            "store_available": True,
            "online_available": None,
            "availability_indicator": None,
            "ean": None,
            "internal_codes": ["83215"],
        }
        wrapper = {
            "lidlPlusText": "Con Lidl Plus",
            "price": {
                "price": 1.19,
                "oldPrice": 1.75,
                "discount": {"percentageDiscount": 32},
                "packaging": {"text": "1 kg"},
                "startDate": "2026-11-01T23:00:00Z",
                "endDateExclusive": "2026-11-08T23:00:00Z",
            },
        }
        row = importer.price_record(
            common, wrapper, "lidlplus", "weekly", "weekly",
            "2026-11-05T12:00:00+00:00", True,
        )
        self.assertEqual(row["unit_price"], 1.19)
        self.assertEqual(row["old_price"], 1.75)
        self.assertEqual(row["discount_pct"], 32)
        self.assertEqual(row["unit"], "kg")
        self.assertEqual(row["price_box"]["priceSymbol"], "€/kg")
        self.assertTrue(row["requires_lidl_plus"])

    def test_future_price_is_not_marked_as_current(self):
        common = {
            "product_id": "123",
            "article_code": "000123",
            "product_name": "Yogur natural",
            "brand": "Milbona",
            "category": "Lácteos",
            "description": None,
            "image_url": None,
            "product_url": None,
            "store_available": True,
            "online_available": None,
            "availability_indicator": None,
            "ean": None,
            "internal_codes": [],
        }
        wrapper = {
            "price": 1.29,
            "packaging": "4 x 125 g",
            "startDate": "2026-11-08T23:00:00Z",
            "endDateExclusive": "2026-11-15T23:00:00Z",
        }
        row = importer.price_record(
            common, wrapper, "future_regular", "weekly", "next_week",
            "2026-11-05T12:00:00+00:00",
        )
        self.assertEqual(row["unit_price"], 1.29)
        self.assertEqual(row["valid_from"], "2026-11-08T23:00:00+00:00")
        self.assertEqual(row["price_type"], "future_regular")

    def test_online_product_keeps_article_code_for_offer_join(self):
        item = {
            "gridbox": {
                "data": {
                    "productId": 9001,
                    "nat": "0083215",
                    "ians": ["83215"],
                    "fullTitle": "Patata granel",
                    "price": {"price": 1.49, "oldPrice": 1.79},
                    "brand": {"name": "Lidl"},
                    "keyfacts": {"wonCategoryPrimary": "Frutas y hortalizas"},
                }
            }
        }
        row = importer.parse_online_product(item, "2026-11-05T12:00:00+00:00")
        self.assertEqual(row["product_id"], "9001")
        self.assertEqual(row["article_code"], "0083215")
        self.assertEqual(row["unit_price"], 1.49)
        self.assertEqual(row["price_box"]["largePartNumeric"], 1.49)

    def test_page_parser_extracts_embedded_product_json(self):
        product = {"productId": 1, "fullTitle": "Patata granel"}
        markup = '<div data-grid-data="' + json.dumps(product).replace('"', '&quot;') + '"></div>'
        parser = importer.ProductAttributeParser()
        parser.feed(markup)
        self.assertEqual(len(parser.products), 1)
        self.assertEqual(parser.products[0]["fullTitle"], "Patata granel")

    def test_pagination_parser_collects_only_pagination_links(self):
        markup = """
        <a href="/producto/leche">Leche</a>
        <nav aria-label="Paginación">
          <a href="?page=1">1</a>
          <a href="?page=2">2</a>
          <a rel="next" href="?page=3">Siguiente</a>
        </nav>
        """
        parser = importer.PaginationLinkParser()
        parser.feed(markup)
        self.assertEqual(parser.links, ["?page=1", "?page=2", "?page=3"])

    def test_food_category_filter_accepts_grocery_and_rejects_bazaar(self):
        self.assertTrue(importer.is_food_product({
            "category": "Mundos de necesidad/Comida y bebida/Leche y nata"
        }))
        self.assertFalse(importer.is_food_product({
            "category": "Cocina y cuidado del hogar/Pequeño electrodoméstico"
        }))
        self.assertFalse(importer.is_food_product({
            "category": "Non-food/Home and Garden"
        }))


    def test_food_search_accepts_product_when_lidl_category_is_numeric(self):
        row = {
            "product_name": "Leche semidesnatada Milbona",
            "description": "Leche UHT 1 litro",
            "category": "0/17/1740/174014",
        }
        self.assertTrue(importer.is_food_product(row, "leche"))

    def test_food_search_does_not_accept_incidental_substring(self):
        row = {
            "product_name": "Plancha eléctrica compacta",
            "description": "Ideal para cocinar",
            "category": "0/17/1740/174014",
        }
        self.assertFalse(importer.is_food_product(row, "pan"))

    def test_food_search_rejects_explicit_non_food_category(self):
        row = {
            "product_name": "Leche de limpieza para muebles",
            "description": "",
            "category": "Non-food/Home and Garden",
        }
        self.assertFalse(importer.is_food_product(row, "leche"))

    def test_region_resolver_uses_castellon_price_region(self):
        product = {
            "regionsV2": {
                "36": {"regionName": "Castellón", "regionPriceId": 1},
                "37": {"regionName": "Valencia", "regionPriceId": 1},
            },
            "regionsPrices": {"1": {"currentPrice": {"price": 1.19}}},
        }
        self.assertEqual(importer.resolve_price_region(product, "Castellón"), "1")


if __name__ == "__main__":
    unittest.main()
