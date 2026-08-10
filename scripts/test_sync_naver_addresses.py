import csv
import json
import tempfile
import unittest
from pathlib import Path

from scripts.add_restaurants import RegistrationError
from scripts.sync_naver_addresses import (
    apply_verified_results,
    load_reports,
    repair_composite_gwangju_regions,
    select_shard,
    select_unverified,
    sync_one,
)
from scripts.update_restaurants import load_targets, target_key


class SyncNaverAddressesTest(unittest.TestCase):
    def record(self, **changes):
        value = {
            "targetKey": "place:123456789:test",
            "name": "테스트식당 강남점",
            "address": "서울 강남구 잘못로 1",
            "naverPlaceUrl": "https://map.naver.com/p/entry/place/123456789",
            "region": {"sido": "서울특별시", "sigungu": "강남구", "eupmyeondong": ""},
        }
        value.update(changes)
        return value

    def detail(self, **changes):
        value = {
            "title": "테스트식당 강남점",
            "roadAddress": "서울 강남구 올바른로 10 1층",
            "address": "서울 강남구 역삼동 10",
        }
        value.update(changes)
        return value

    def test_direct_place_id_and_exact_title_prepare_address(self):
        result = sync_one(self.record(), lambda _place_id: self.detail())
        self.assertEqual(result["status"], "ready-direct")
        self.assertEqual(result["naverAddress"], "서울 강남구 올바른로 10 1층")
        self.assertEqual(result["naverRegion"]["sido"], "서울특별시")

    def test_title_mismatch_is_never_applied(self):
        result = sync_one(
            self.record(), lambda _place_id: self.detail(title="다른식당 강남점")
        )
        self.assertEqual(result["status"], "review")
        self.assertEqual(result["issue"], "naver-place-title-mismatch")

    def test_disjoint_place_menu_is_never_applied(self):
        result = sync_one(
            self.record(mainDishes=["초밥", "파스타"]),
            lambda _place_id: self.detail(mainDishes=["순대국밥", "수육"]),
        )
        self.assertEqual(result["status"], "review")
        self.assertEqual(result["issue"], "naver-place-menu-mismatch")

    def test_one_matching_place_menu_allows_address_check(self):
        result = sync_one(
            self.record(mainDishes=["순대국밥", "파스타"]),
            lambda _place_id: self.detail(mainDishes=["순대국밥", "수육"]),
        )
        self.assertEqual(result["status"], "ready-direct")

    def test_raw_naver_address_is_kept_even_when_only_notation_differs(self):
        record = self.record(address="강원특별자치도 춘천시 춘천로 271 1층")
        detail = self.detail(
            title=record["name"],
            roadAddress="강원 춘천시 춘천로 271 1층",
            address="강원 춘천시 후평동 271",
        )
        result = sync_one(record, lambda _place_id: detail)
        self.assertEqual(result["status"], "ready-direct")
        self.assertEqual(result["naverAddress"], detail["roadAddress"])

    def test_failed_direct_lookup_uses_only_double_checked_search(self):
        candidate = {
            "title": "<b>테스트식당 강남점</b>",
            "roadAddress": "서울 강남구 올바른로 10 1층",
            "address": "서울 강남구 역삼동 10",
        }

        def failed(_place_id):
            raise RegistrationError("일시 오류")

        result = sync_one(self.record(), failed, lambda _query: [candidate])
        self.assertEqual(result["status"], "ready-search")
        self.assertEqual(result["naverAddress"], candidate["roadAddress"])

    def test_ambiguous_fallback_is_never_applied(self):
        first = self.detail()
        second = self.detail(roadAddress="서울 강남구 올바른로 20")

        def failed(_place_id):
            raise RegistrationError("일시 오류")

        result = sync_one(self.record(), failed, lambda _query: [first, second])
        self.assertEqual(result["status"], "review")
        self.assertIn("ambiguous", result["issue"])

    def test_shards_cover_every_record_once(self):
        records = [{"targetKey": str(index)} for index in range(17)]
        selected = [
            item
            for shard in range(4)
            for item in select_shard(records, shard, 4)
        ]
        self.assertEqual(
            sorted(int(item["targetKey"]) for item in selected), list(range(17))
        )

    def test_unverified_filter_excludes_only_naver_synced_records(self):
        records = [
            {"targetKey": "new"},
            {"targetKey": "admin", "updateSource": "github-admin-edit"},
            {"targetKey": "done", "updateSource": "github-naver-address-sync"},
        ]
        self.assertEqual(
            [record["targetKey"] for record in select_unverified(records)],
            ["new", "admin"],
        )

    def test_composite_gwangju_region_repair_keeps_true_jeonnam(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "overrides.json"
            records = [
                {
                    "targetKey": "gwangju",
                    "address": "전남광주 광산구 임방울대로 123",
                    "region": {"sido": "전라남도", "sigungu": "광산구"},
                },
                {
                    "targetKey": "naju",
                    "address": "전남광주 나주시 빛가람로 123",
                    "region": {"sido": "전라남도", "sigungu": "나주시"},
                },
            ]
            output.write_text(
                json.dumps(records, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

            self.assertEqual(repair_composite_gwangju_regions(output), 1)
            saved = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(saved[0]["region"]["sido"], "광주광역시")
            self.assertEqual(saved[1]["region"]["sido"], "전라남도")

    def test_load_reports_rejects_missing_shard(self):
        with tempfile.TemporaryDirectory() as temp:
            report = Path(temp) / "shard-0.json"
            report.write_text(
                json.dumps(
                    {
                        "shardIndex": 0,
                        "shardCount": 2,
                        "summary": {"total": 1},
                        "results": [{"targetKey": "first"}],
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(Exception, "완전하지 않습니다"):
                load_reports([report])

    def test_apply_preserves_non_address_fields(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base_csv = root / "base.csv"
            admin_data = root / "admin.json"
            overrides = root / "overrides.json"
            fields = [
                "상호명", "대표주소", "네이버플레이스", "이미지", "지역_시도",
                "지역_시군구", "지역_읍면동", "식당유형_대", "식당유형_세부",
                "주요리_대표", "검색태그",
            ]
            row = {
                "상호명": "테스트식당 강남점",
                "대표주소": "서울 강남구 잘못로 1",
                "네이버플레이스": "https://map.naver.com/p/entry/place/123456789",
                "이미지": "https://example.com/keep.jpg",
                "지역_시도": "서울특별시", "지역_시군구": "강남구", "지역_읍면동": "",
                "식당유형_대": "한식", "식당유형_세부": "백반",
                "주요리_대표": "쌀밥,제육볶음", "검색태그": "한식,좋은쌀",
            }
            with base_csv.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerow(row)
            admin_data.write_text("[]\n", encoding="utf-8")
            overrides.write_text("[]\n", encoding="utf-8")
            key = target_key(
                {"name": row["상호명"], "address": row["대표주소"], "naverPlaceUrl": row["네이버플레이스"]}
            )
            result = {
                "targetKey": key,
                "name": row["상호명"],
                "placeId": "123456789",
                "currentAddress": row["대표주소"],
                "currentRegion": {
                    "sido": "서울특별시", "sigungu": "강남구", "eupmyeondong": ""
                },
                "naverTitle": row["상호명"],
                "naverAddress": "서울 강남구 올바른로 10 1층",
                "naverJibunAddress": "서울 강남구 역삼동 10",
                "naverRegion": {"sido": "서울특별시", "sigungu": "강남구", "eupmyeondong": "역삼동"},
                "source": "direct",
                "status": "ready-direct",
                "issue": "",
            }
            summary = apply_verified_results(
                [result], base_csv=base_csv, admin_data=admin_data,
                output=overrides, expected_total=1,
            )
            saved = json.loads(overrides.read_text(encoding="utf-8"))[0]
            merged, _ = load_targets(base_csv, admin_data, overrides)
            merged_record = merged[key]
            self.assertEqual(summary["applied"], 1)
            self.assertEqual(saved["address"], result["naverAddress"])
            self.assertNotIn("imageUrl", saved)
            self.assertEqual(merged_record["imageUrl"], row["이미지"])
            self.assertEqual(merged_record["category"], "한식")
            self.assertEqual(merged_record["mainDishes"], ["쌀밥", "제육볶음"])

    def test_apply_marks_unchanged_direct_result_as_verified(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base_csv = root / "base.csv"
            admin_data = root / "admin.json"
            overrides = root / "overrides.json"
            row = {
                "상호명": "일치식당",
                "대표주소": "서울 강남구 올바른로 10 1층",
                "네이버플레이스": "https://map.naver.com/p/entry/place/123456789",
                "지역_시도": "서울특별시",
                "지역_시군구": "강남구",
                "지역_읍면동": "역삼동",
            }
            with base_csv.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=list(row))
                writer.writeheader()
                writer.writerow(row)
            admin_data.write_text("[]\n", encoding="utf-8")
            overrides.write_text("[]\n", encoding="utf-8")
            key = target_key(
                {
                    "name": row["상호명"],
                    "address": row["대표주소"],
                    "naverPlaceUrl": row["네이버플레이스"],
                }
            )
            region = {
                "sido": "서울특별시",
                "sigungu": "강남구",
                "eupmyeondong": "역삼동",
            }
            result = {
                "targetKey": key,
                "name": row["상호명"],
                "placeId": "123456789",
                "currentAddress": row["대표주소"],
                "currentRegion": region,
                "naverTitle": row["상호명"],
                "naverAddress": row["대표주소"],
                "naverJibunAddress": "서울 강남구 역삼동 10",
                "naverRegion": region,
                "source": "direct",
                "status": "unchanged",
                "issue": "",
            }

            summary = apply_verified_results(
                [result],
                base_csv=base_csv,
                admin_data=admin_data,
                output=overrides,
                expected_total=1,
            )

            targets, _ = load_targets(base_csv, admin_data, overrides)
            self.assertEqual(summary["applied"], 1)
            self.assertEqual(targets[key]["updateSource"], "github-naver-address-sync")
            self.assertEqual(select_unverified(targets.values()), [])

    def test_apply_does_not_revalidate_unrelated_legacy_menu_text(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base_csv = root / "base.csv"
            admin_data = root / "admin.json"
            overrides = root / "overrides.json"
            fields = ["상호명", "대표주소", "네이버플레이스", "주요리_대표"]
            row = {
                "상호명": "레거시식당",
                "대표주소": "서울 강남구 이전로 1",
                "네이버플레이스": "https://map.naver.com/p/entry/place/987654321",
                "주요리_대표": "동파육 솥밥/안키모 솥밥 <feat.달고기>",
            }
            with base_csv.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerow(row)
            admin_data.write_text("[]\n", encoding="utf-8")
            overrides.write_text("[]\n", encoding="utf-8")
            key = target_key(
                {
                    "name": row["상호명"],
                    "address": row["대표주소"],
                    "naverPlaceUrl": row["네이버플레이스"],
                }
            )
            result = {
                "targetKey": key,
                "name": row["상호명"],
                "placeId": "987654321",
                "currentAddress": row["대표주소"],
                "currentRegion": {"sido": "", "sigungu": "", "eupmyeondong": ""},
                "naverTitle": row["상호명"],
                "naverAddress": "서울 강남구 올바른로 10",
                "naverJibunAddress": "서울 강남구 역삼동 10",
                "naverRegion": {
                    "sido": "서울특별시",
                    "sigungu": "강남구",
                    "eupmyeondong": "역삼동",
                },
                "source": "direct",
                "status": "ready-direct",
                "issue": "",
            }

            summary = apply_verified_results(
                [result],
                base_csv=base_csv,
                admin_data=admin_data,
                output=overrides,
                expected_total=1,
            )

            saved = json.loads(overrides.read_text(encoding="utf-8"))[0]
            merged, _ = load_targets(base_csv, admin_data, overrides)
            self.assertEqual(summary["applied"], 1)
            self.assertNotIn("mainDishes", saved)
            self.assertEqual(
                merged[key]["mainDishes"], [row["주요리_대표"]]
            )
            self.assertEqual(
                merged[key]["address"], result["naverAddress"]
            )

    def test_apply_rejects_place_id_shared_by_multiple_targets(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base_csv = root / "base.csv"
            admin_data = root / "admin.json"
            overrides = root / "overrides.json"
            fields = ["상호명", "대표주소", "네이버플레이스"]
            rows = [
                {
                    "상호명": "같은이름 서울점",
                    "대표주소": "서울 강남구 이전로 1",
                    "네이버플레이스": "https://map.naver.com/p/entry/place/123456789",
                },
                {
                    "상호명": "같은이름 부산점",
                    "대표주소": "부산 해운대구 이전로 2",
                    "네이버플레이스": "https://map.naver.com/p/entry/place/123456789",
                },
            ]
            with base_csv.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerows(rows)
            admin_data.write_text("[]\n", encoding="utf-8")
            overrides.write_text("[]\n", encoding="utf-8")
            targets, _ = load_targets(base_csv, admin_data, overrides)
            key = next(key for key, record in targets.items() if record["name"] == rows[0]["상호명"])
            result = {
                "targetKey": key,
                "name": rows[0]["상호명"],
                "placeId": "123456789",
                "currentAddress": rows[0]["대표주소"],
                "currentRegion": {},
                "naverTitle": rows[0]["상호명"],
                "naverAddress": "서울 강남구 올바른로 10",
                "naverJibunAddress": "서울 강남구 역삼동 10",
                "naverRegion": {
                    "sido": "서울특별시", "sigungu": "강남구", "eupmyeondong": "역삼동"
                },
                "source": "direct",
                "status": "ready-direct",
                "issue": "",
            }
            summary = apply_verified_results(
                [result], base_csv=base_csv, admin_data=admin_data,
                output=overrides, expected_total=1,
            )
            self.assertEqual(summary["applied"], 0)
            self.assertEqual(
                summary["rejected"][0]["reason"],
                "place-id-shared-by-multiple-targets",
            )

    def test_apply_rejects_stale_current_record(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base_csv = root / "base.csv"
            admin_data = root / "admin.json"
            overrides = root / "overrides.json"
            row = {
                "상호명": "테스트식당",
                "대표주소": "서울 강남구 현재로 1",
                "네이버플레이스": "https://map.naver.com/p/entry/place/123456789",
            }
            with base_csv.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=row.keys())
                writer.writeheader()
                writer.writerow(row)
            admin_data.write_text("[]\n", encoding="utf-8")
            overrides.write_text("[]\n", encoding="utf-8")
            key = next(iter(load_targets(base_csv, admin_data, overrides)[0]))
            result = {
                "targetKey": key,
                "name": row["상호명"],
                "placeId": "123456789",
                "currentAddress": "서울 강남구 오래된로 1",
                "currentRegion": {},
                "naverTitle": row["상호명"],
                "naverAddress": "서울 강남구 올바른로 10",
                "naverJibunAddress": "서울 강남구 역삼동 10",
                "naverRegion": {
                    "sido": "서울특별시", "sigungu": "강남구", "eupmyeondong": "역삼동"
                },
                "source": "direct",
                "status": "ready-direct",
                "issue": "",
            }
            summary = apply_verified_results(
                [result], base_csv=base_csv, admin_data=admin_data,
                output=overrides, expected_total=1,
            )
            self.assertEqual(summary["applied"], 0)
            self.assertEqual(summary["rejected"][0]["reason"], "current-record-changed")

    def test_apply_requires_complete_current_unverified_scope(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            base_csv = root / "base.csv"
            admin_data = root / "admin.json"
            overrides = root / "overrides.json"
            row = {
                "상호명": "테스트식당",
                "대표주소": "서울 강남구 현재로 1",
                "네이버플레이스": "https://map.naver.com/p/entry/place/123456789",
            }
            with base_csv.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=row.keys())
                writer.writeheader()
                writer.writerow(row)
            admin_data.write_text("[]\n", encoding="utf-8")
            overrides.write_text("[]\n", encoding="utf-8")
            with self.assertRaisesRegex(Exception, "미검증 대상"):
                apply_verified_results(
                    [], base_csv=base_csv, admin_data=admin_data,
                    output=overrides, unverified_only=True,
                )


if __name__ == "__main__":
    unittest.main()
