import unittest

from scripts.audit_restaurant_data import (
    LocationHint,
    audit_one,
    infer_precise_region,
    unique_exact_candidate,
)


def local_item(
    title="가마솥순대국밥 강릉교동점",
    road_address="강원특별자치도 강릉시 율곡초교길 21",
    address="강원특별자치도 강릉시 교동 123-4",
    category="한식>순대,순댓국",
):
    return {
        "title": title,
        "roadAddress": road_address,
        "address": address,
        "category": category,
        "description": "",
    }


class RestaurantDataAuditTest(unittest.TestCase):
    def test_precise_region_keeps_composite_city_district(self):
        self.assertEqual(
            infer_precise_region(
                "경기 수원시 영통구 센트럴타운로 107",
                "경기 수원시 영통구 이의동 1331",
            ),
            {
                "sido": "경기도",
                "sigungu": "수원시 영통구",
                "eupmyeondong": "이의동",
            },
        )

    def test_exact_candidate_rejects_same_name_at_two_addresses(self):
        first = local_item(road_address="강원 강릉시 길 1")
        second = local_item(road_address="강원 강릉시 길 2")
        candidate, state = unique_exact_candidate(
            [first, second], "가마솥순대국밥 강릉교동점"
        )
        self.assertIsNone(candidate)
        self.assertEqual(state, "ambiguous:2")

    def test_two_matching_queries_prepare_address_and_url_fix(self):
        candidate = local_item()
        queries = []

        def lookup(query):
            queries.append(query)
            return [candidate]

        record = {
            "targetKey": "place:1874772103:test",
            "source": "base",
            "name": "가마솥순대국밥 강릉교동점",
            "address": "서울 송파구 오금로 544",
            "naverPlaceUrl": "https://map.naver.com/p/entry/place/1874772103",
            "imageUrl": "https://example.com/restaurant.jpg",
            "region": {"sido": "서울특별시", "sigungu": "송파구", "eupmyeondong": ""},
            "category": "순대,순댓국",
            "categoryDetail": "국밥/탕",
            "mainDishes": ["순대국밥"],
            "searchTags": ["순대", "국밥"],
            "registrationType": "ozicme",
        }
        wrong_detail = {
            "title": "다른 식당",
            "roadAddress": "서울 송파구 오금로 544",
            "address": "서울 송파구 거여동 1",
        }
        result = audit_one(
            record,
            LocationHint("강원", "강릉시", "교동"),
            lookup,
            lambda _place_id: wrong_detail,
            check_detail=True,
        )

        self.assertEqual(len(queries), 2)
        self.assertEqual(result["status"], "fix-ready")
        self.assertEqual(result["changes"]["address"], candidate["roadAddress"])
        self.assertEqual(result["changes"]["region"]["sido"], "강원특별자치도")
        self.assertIn("/p/search/", result["changes"]["naverPlaceUrl"])
        self.assertIn("address_mismatch", result["issues"])
        self.assertFalse(result["doubleCheck"]["placeDetail"]["matched"])

    def test_conflicting_second_query_never_changes_record(self):
        first = local_item()
        second = local_item(
            road_address="강원특별자치도 강릉시 경강로 999",
            address="강원특별자치도 강릉시 포남동 999",
        )
        calls = 0

        def lookup(_query):
            nonlocal calls
            calls += 1
            return [first] if calls == 1 else [second]

        result = audit_one(
            {
                "targetKey": "record:test",
                "source": "base",
                "name": "가마솥순대국밥 강릉교동점",
                "address": "서울 송파구 오금로 544",
                "naverPlaceUrl": "",
                "region": {},
                "category": "순대,순댓국",
                "mainDishes": [],
                "searchTags": [],
            },
            LocationHint("강원", "강릉시", "교동"),
            lookup,
            lambda _place_id: {},
            check_detail=False,
        )
        self.assertEqual(result["status"], "review")
        self.assertEqual(result["changes"], {})
        self.assertIn("double-check-conflict", result["issues"])

    def test_generic_category_is_replaced_only_after_double_check(self):
        candidate = local_item(
            title="카즈카잔",
            road_address="서울특별시 중구 세종대로 17",
            address="서울특별시 중구 남대문로5가 6-1",
            category="음식점>일식>일식당",
        )
        result = audit_one(
            {
                "targetKey": "record:kaz",
                "source": "admin",
                "name": "카즈카잔",
                "address": "서울특별시 중구 세종대로 17",
                "naverPlaceUrl": "https://map.naver.com/p/search/kaz",
                "region": {"sido": "서울특별시", "sigungu": "중구", "eupmyeondong": ""},
                "category": "음식점",
                "categoryDetail": "",
                "mainDishes": ["돈까스"],
                "searchTags": ["돈까스"],
            },
            LocationHint(),
            lambda _query: [candidate],
            lambda _place_id: {},
            check_detail=False,
        )
        self.assertEqual(result["changes"]["category"], "일식")
        self.assertEqual(result["status"], "fix-ready")


if __name__ == "__main__":
    unittest.main()
