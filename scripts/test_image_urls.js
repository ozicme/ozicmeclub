const assert = require("node:assert/strict");
const imageUrls = require("../image-url-utils.js");

const source = "https://video-phinf.pstatic.net/20250714_92/example_JPEG/thumb_03.jpg";
const proxy = `https://search.pstatic.net/common/?autoRotate=true&type=w560_sharpen&src=${encodeURIComponent(source)}`;

assert.equal(imageUrls.invalidReason(proxy), "");
assert.equal(imageUrls.normalize(proxy), proxy);
assert.deepEqual(imageUrls.candidateUrls(proxy), [
  proxy,
  source,
  `https://search.pstatic.net/common/?src=${encodeURIComponent(source)}`,
]);

assert.match(
  imageUrls.invalidReason("https://search.pstatic.net/common/?autoRotate=true…thumb.jpg"),
  /잘렸습니다/
);
assert.match(
  imageUrls.invalidReason("https://search.pstatic.net/https://search.pstatic.net/common/?src=x"),
  /중복/
);
assert.match(
  imageUrls.invalidReason("https://search.pstatic.net/common/?type=w560"),
  /원본\(src\)/
);
assert.match(imageUrls.invalidReason("https://example.com/movie.mp4"), /동영상/);
assert.match(
  imageUrls.invalidReason("https://map.naver.com/p/entry/place/123456789"),
  /실제 이미지 주소/
);
assert.equal(
  imageUrls.normalize("http://ldb-phinf.pstatic.net/example.jpg"),
  "https://ldb-phinf.pstatic.net/example.jpg"
);

console.log("대표 이미지 URL 브라우저 검증 테스트 통과");
