from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

try:
    from scripts.refresh_naver_images import (
        extract_static_image_urls,
        is_static_image_url,
        merge_results,
        names_compatible,
    )
except ModuleNotFoundError:
    from refresh_naver_images import (  # type: ignore
        extract_static_image_urls,
        is_static_image_url,
        merge_results,
        names_compatible,
    )


class RefreshNaverImagesTest(unittest.TestCase):
    def test_static_url_filter_rejects_gif_and_video(self):
        self.assertFalse(is_static_image_url("https://example.com/hero.gif"))
        self.assertFalse(is_static_image_url("https://example.com/movie.mp4"))
        self.assertFalse(
            is_static_image_url(
                "https://search.pstatic.net/common/?src=https%3A%2F%2Fexample.com%2Fa.gif"
            )
        )
        self.assertTrue(is_static_image_url("https://example.com/hero.jpg"))
        self.assertTrue(is_static_image_url("https://ldb-phinf.pstatic.net/example/abc"))

    def test_first_static_image_is_selected_after_video_and_gif(self):
        state = {
            "Media:1": {"mediaType": "video", "thumbnailUrl": "https://example.com/video-thumb.jpg"},
            "Media:2": {"imageUrl": "https://example.com/animated.gif"},
            "Media:3": {"imageUrl": "https://example.com/first.webp"},
            "Media:4": {"imageUrl": "https://example.com/second.jpg"},
        }
        base = {
            "images": [
                {"__ref": "Media:1"},
                {"__ref": "Media:2"},
                {"__ref": "Media:3"},
                {"__ref": "Media:4"},
            ]
        }
        images = extract_static_image_urls(base, state, "12345")
        self.assertEqual(images[0], "https://example.com/first.webp")
        self.assertNotIn("https://example.com/video-thumb.jpg", images)
        self.assertNotIn("https://example.com/animated.gif", images)

    def test_names_allow_branch_suffix(self):
        self.assertTrue(names_compatible("가마솥순대국밥 강릉교동점", "가마솥순대국밥 강릉교동점"))
        self.assertTrue(names_compatible("예향정", "예향정 인천청라점"))
        self.assertFalse(names_compatible("예향정", "다른식당"))

    def test_merge_only_changes_image_field(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            override = root / "restaurant-overrides.json"
            override.write_text(
                json.dumps(
                    [
                        {
                            "targetKey": "place:1:abc",
                            "name": "기존상호",
                            "address": "기존주소",
                            "imageUrl": "https://old.example/old.jpg",
                            "category": "한식",
                        }
                    ],
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            for index in range(2):
                shard = root / f"shard-{index}"
                shard.mkdir()
                payload = {
                    "shardIndex": index,
                    "shardCount": 2,
                    "stats": {"processed": 1},
                    "failures": [],
                    "updates": (
                        [
                            {
                                "targetKey": "place:1:abc",
                                "imageUrl": "https://new.example/new.webp",
                            }
                        ]
                        if index == 0
                        else []
                    ),
                }
                (shard / "result.json").write_text(
                    json.dumps(payload, ensure_ascii=False), encoding="utf-8"
                )

            report = merge_results(root, override)
            merged = json.loads(override.read_text(encoding="utf-8"))
            self.assertEqual(report["updatesApplied"], 1)
            self.assertEqual(merged[0]["name"], "기존상호")
            self.assertEqual(merged[0]["address"], "기존주소")
            self.assertEqual(merged[0]["category"], "한식")
            self.assertEqual(merged[0]["imageUrl"], "https://new.example/new.webp")
            self.assertEqual(merged[0]["updateSource"], "github-naver-image-refresh")


if __name__ == "__main__":
    unittest.main()
