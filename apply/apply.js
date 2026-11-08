(() => {
  const form = document.getElementById("restaurant-application");
  const submitButton = document.getElementById("submit-button");
  const submittedAt = document.getElementById("submitted-at");
  if (!form || !submitButton || !submittedAt) return;

  form.addEventListener("submit", () => {
    submittedAt.value = new Intl.DateTimeFormat("ko-KR", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "Asia/Seoul",
    }).format(new Date());
    submitButton.disabled = true;
    submitButton.textContent = "등재 요청을 보내는 중입니다...";
  });
})();
