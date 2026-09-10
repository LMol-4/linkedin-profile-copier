const clipboardOutput = document.getElementById("clipboard-output");

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.target !== "offscreen" || request?.type !== "COPY_TEXT") {
    return false;
  }

  try {
    clipboardOutput.value = String(request.text || "");
    clipboardOutput.select();

    if (!document.execCommand("copy")) {
      throw new Error("Chrome blocked the automatic clipboard write.");
    }

    sendResponse({ ok: true });
  } catch (error) {
    sendResponse({
      ok: false,
      error: error.message || "Chrome blocked the automatic clipboard write."
    });
  } finally {
    clipboardOutput.value = "";
  }

  return false;
});
