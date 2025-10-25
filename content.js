// Grab page content.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.action === "extractProduct") {
		const pageText = Array.from(
			document.body.querySelectorAll("p, h1, h2, h3, h4, h5, h6, span")
		)
			.map((el) => el.innerText)
			.join("\n")
			.trim();

		sendResponse({ pageText });
		return true;
	}
});
