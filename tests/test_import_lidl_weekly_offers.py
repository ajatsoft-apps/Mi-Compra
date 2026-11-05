import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "import_lidl_weekly_offers.py"
SPEC = importlib.util.spec_from_file_location("lidl_importer", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class LidlOfferNormalizationTests(unittest.TestCase):
    def test_normalizes_offer_without_inventing_ean(self):
        result = MODULE.normalize_offer({
            "id": "offer-123",
            "title": "Aceite de oliva",
            "brand": "Marca",
            "productIds": ["0080088"],
            "offerType": "StoreSpecialPriceDiscount",
            "redemptionChannel": "Store",
            "priceBox": {"largePartNumeric": "3,99", "largePartSymbol": "€"},
            "startValidityDate": "2026-11-02T00:00:00Z",
            "endValidityDate": "2026-11-08T23:59:59Z",
            "imageUrl": "https://example.invalid/image.jpg",
        })
        self.assertIsNotNone(result)
        self.assertEqual(result["offer_id"], "offer-123")
        self.assertEqual(result["product_ids"], ["0080088"])
        self.assertEqual(result["price_box"]["largePartNumeric"], "3,99")
        self.assertNotIn("ean", result)
        self.assertNotIn("barcode", result)

    def test_rejects_missing_offer_id_or_title(self):
        self.assertIsNone(MODULE.normalize_offer({"id": "x", "title": ""}))
        self.assertIsNone(MODULE.normalize_offer({"title": "Producto"}))

    def test_invalid_dates_are_null(self):
        self.assertIsNone(MODULE.parse_datetime("not-a-date"))

    def test_date_only_values_are_valid_iso_timestamps(self):
        value = MODULE.parse_datetime("2026-11-02")
        self.assertTrue(value.startswith("2026-11-02T"))

    def test_household_id_must_be_explicit_uuid(self):
        self.assertIsNotNone(MODULE.UUID_RE.fullmatch("123e4567-e89b-42d3-a456-426614174000"))
        self.assertIsNone(MODULE.UUID_RE.fullmatch(""))
        self.assertIsNone(MODULE.UUID_RE.fullmatch("all-households"))


if __name__ == "__main__":
    unittest.main()
