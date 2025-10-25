const btn = document.getElementById("summarize-button");
const tabList = document.getElementById("tab-list");
const tableWrapper = document.getElementById("table-wrapper-div");
const tabTable = document.getElementById("tab-table");
const loadingTable = document.getElementById("loading-table");

// Load UI
document.addEventListener("DOMContentLoaded", async () => {
	try {
		const tabs = await chrome.tabs.query({ currentWindow: true });

		if (!tabs || tabs.length === 0) {
			tabList.textContent = "No tabs found.";
			return;
		}
		tabList.innerHTML = "";

		tabs.forEach((tab) => {
			const tr = document.createElement("tr");

			// Tab cell
			const titleTd = document.createElement("td");
			const div = document.createElement("div");
			div.className = "truncate-multiline";
			div.textContent = tab.title || "(no title)";
			titleTd.appendChild(div);
			tr.appendChild(titleTd);

			// Checkbox cell
			const checkboxTd = document.createElement("td");
			const checkbox = document.createElement("input");
			checkbox.type = "checkbox";
			checkbox.checked = true;
			checkbox.id = tab.id;
			checkboxTd.appendChild(checkbox);
			tr.appendChild(checkboxTd);

			tabList.appendChild(tr);
		});
	} catch (err) {
		console.error(err);
		tabList.textContent = "Error loading tabs: " + err.message;
	}
});

// Start summarizing
btn.addEventListener("click", async () => {
	setLoading(true);
	try {
		const tabs = await chrome.tabs.query({ currentWindow: true });
		const tabIds = new Set(tabs.map((tab) => String(tab.id)));

		const checkboxes = document.querySelectorAll('#tab-list input[type="checkbox"]');
		const checkedTabs = [];
		checkboxes.forEach((cb) => {
			if (tabIds.has(cb.id) && cb.checked) {
				checkedTabs.push(cb.id);
			}
		});

		const context =
			"You are an e-commerce shopping assistant agent. You specialize in providing complete and concise summaries of products, comparing different products against one another and guiding users to purchasing products that that gets them the most value for their money. Use the tools available to you to resolve the issue efficiently and professionally. Your goal is to find the best product for a user as quickly as possible. Start by understanding each product deeply before summarizing, comparing and making recommendations. One or more products may be completely unrelated. If they are, still do your best to accomplish your goal. Do not make things up.";
		let options;
		const availability = await Summarizer.availability();
		if (availability === "unavailable") {
			options = {
				sharedContext: context,
				monitor(m) {
					m.addEventListener("downloadprogress", (e) => {
						console.log(`Downloaded ${e.loaded * 100}%`);
					});
				},
			};
		} else {
			options = {
				sharedContext: context,
			};
		}

		// Check for user activation before creating the summarizer
		let summarizer;
		if (navigator.userActivation.isActive) {
			summarizer = await Summarizer.create(options);
		}

		const productSummaries = [];
		for (const id of checkedTabs) {
			try {
				await chrome.scripting.executeScript({
					target: { tabId: Number(id) },
					files: ["content.js"],
				});

				const { pageText } = await chrome.tabs.sendMessage(Number(id), {
					action: "extractProduct",
				});

				const summary = await summarizer.summarize(pageText);
				productSummaries.push({
					id: id,
					extractedSummary: summary,
				});
			} catch (e) {
				console.warn(`Could not summarize tab ${id}:`, e);
			}
		}

		// We have array of product summaries. Let's do something with them on UI.
		console.log(productSummaries);
	} catch (err) {
		console.error(err);
	}
	setLoading(false);
});

// Handle resize of table height. Handles styled scroll bar and borders.
window.addEventListener("resize", () => {
	const root = document.documentElement;
	const maxTableHeight = getComputedStyle(root)
		.getPropertyValue("--table-max-height")
		.trim()
		.replace("px", "");

	document.querySelectorAll("table").forEach((table) => {
		if (table.offsetHeight > Number(maxTableHeight)) {
			table.querySelectorAll("td:last-child").forEach((td) => {
				td.style.borderRight = "1px solid var(--black)";
			});
		}
	});
});

function setLoading(loading) {
	if (loading) {
		tabTable.style.display = "none";
		loadingTable.style.display = "flex";
		btn.disabled = true;
		tableWrapper.style.border = "none";
	} else {
		tabTable.style.display = "block";
		loadingTable.style.display = "none";
		btn.disabled = false;
		tableWrapper.style.border = "1px solid var(--black)";
	}
}
