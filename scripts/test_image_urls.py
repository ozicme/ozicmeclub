import unittest

from scripts.image_urls import (
    ImageUrlError,
    image_candidate_urls,
    image_url_error,
    normalize_image_url,
)
from scripts.audit_image_urls import is_image_response


class ImageUrlsTest(unittest.TestCase):
    def setUp(self):
        self.source = (
            "https://video-phinf.pstatic.net/20250714_92/"
            "example_JPEG/thumb_03.jpg"
        )
        self.proxy = (
            "https://search.pstatic.net/common/?autoRotate=true&type=w560_sharpen&"
            "src=https%3A%2F%2Fvideo-phinf.pstatic.net%2F20250714_92%2F"
            "example_JPEG%2Fthumb_03.jpg"
        )

    def test_accepts_video_thumbnail_as_still_image(self):
        self.assertEqual(image_url_error(self.proxy), "")
        self.assertEqual(normalize_image_url(self.proxy), self.proxy)
        self.assertEqual(image_candidate_urls(self.proxy)[1], self.source)

    def test_rejects_cut_duplicate_and_non_image_urls(self):
        values = [
            "https://search.pstatic.net/common/?autoRotate=true…thumb.jpg",
            "https://search.pstatic.net/https://search.pstatic.net/common/?src=x",
            "https://search.pstatic.net/common/?type=w560",
            "https://example.com/movie.mp4",
            "https://map.naver.com/p/entry/place/123456789",
        ]
        for value in values:
            with self.subTest(value=value):
                self.assertTrue(image_url_error(value))
                with self.assertRaises(ImageUrlError):
                    normalize_image_url(value)

    def test_upgrades_naver_image_http_url(self):
        self.assertEqual(
            normalize_image_url("http://ldb-phinf.pstatic.net/example.jpg"),
            "https://ldb-phinf.pstatic.net/example.jpg",
        )

    def test_network_response_check_accepts_webp_but_not_generic_riff_video(self):
        self.assertTrue(is_image_response("application/octet-stream", b"RIFF0000WEBPdata"))
        self.assertFalse(is_image_response("video/avi", b"RIFF0000AVI data"))


if __name__ == "__main__":
    unittest.main()
