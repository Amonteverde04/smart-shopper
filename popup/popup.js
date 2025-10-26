const btn = document.getElementById("summarize-button");
const tabList = document.getElementById("tab-list");
const loadingUI = document.getElementById("loading");
const summaryContainer = document.getElementById("summary-comparison-container");
const summaryContent = document.getElementById("summary-content");
const tooltipWrapper = document.querySelector(".tool-tip-wrapper");
const tooltipBox = document.getElementById("tooltip-box");

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
			const label = document.createElement("label");
			label.classList.add("checkmark-container");

			const checkbox = document.createElement("input");
			checkbox.type = "checkbox";
			checkbox.checked = true;
			checkbox.id = tab.id;
			checkbox.name = tab.title;
			checkbox.classList.add("checkmark");

			const span = document.createElement("span");
			span.classList.add("checkmark-inner");

			label.appendChild(checkbox);
			label.appendChild(span);
			checkboxTd.appendChild(label);
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
				checkedTabs.push({ id: cb.id, title: cb.name });
			}
		});

		const context =
			"You are an e-commerce shopping assistant agent. You specialize in providing complete and concise summaries of products, their reviews and pricing. Your goal is to guide users to purchase products that that gets them the most value for their money. Resolve the issue efficiently and professionally while reaching your goal. Do not make things up.";
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

		const tooltipList = document.getElementById("tooltip-list");
		tooltipWrapper.style.display = "none";

		const productSummaries = [];
		for (const tab of checkedTabs) {
			try {
				await chrome.scripting.executeScript({
					target: { tabId: Number(tab.id) },
					files: ["content.js"],
				});

				const { pageText } = await chrome.tabs.sendMessage(Number(tab.id), {
					action: "extractProduct",
				});

				const summary = await summarizer.summarize(pageText);
				productSummaries.push({
					id: tab.id,
					title: tab.name,
					extractedSummary: summary,
				});
			} catch (e) {
				tooltipWrapper.style.display = "block";
				const warningMessage = `Could not summarize tab "${tab.title}" - ${e}`;
				console.warn(warningMessage);
				const li = document.createElement("li");
				li.textContent = warningMessage;
				li.style.marginLeft = "12px";
				li.style.marginBottom = "6px";
				tooltipList.appendChild(li);
			}
		}

		if (productSummaries.length > 0) {
			// We have array of product summaries. Let's do something with them on UI.
			summaryContent.innerHTML = productSummaries
				.map(
					(p, i) => `
      				<div class="summary-card">
      					<div class="summary-header">Product ${i + 1}</div>
      				  	<div class="summary-body">
						  	<ul>
        				  		${p.extractedSummary
									.split("\n")
									.map(
										(line) =>
											`<li class="summary-item">${line.replace(
												/^\*\s*/,
												""
											)}</li>`
									)
									.join("")}
        					</ul>
					  	</div>
      				</div>`
				)
				.join("");
			summaryContainer.style.display = "block";
			scrollToId(summaryContainer.id);
		}
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
				td.style.borderRight = "1px solid var(--foreground)";
			});
		}
	});
});

function toggleElementsDisabled(selectors, disabled) {
	document.querySelectorAll(selectors).forEach((el) => {
		el.disabled = disabled;
		el.classList.toggle("disabled", disabled);
	});
}

function setLoading(isLoading) {
	toggleElementsDisabled(".checkmark", isLoading);
	toggleElementsDisabled(".checkmark-container", isLoading);

	tabList.classList.toggle("disabled", isLoading);
	btn.disabled = isLoading;
	loadingUI.style.display = isLoading ? "flex" : "none";
}

function scrollToId(id, delay = 100) {
	setTimeout(() => {
		const element = document.getElementById(id);
		if (element) {
			element.scrollIntoView({ behavior: "smooth", block: "start" });
		}
	}, delay);
}

tooltipWrapper.addEventListener("mouseenter", () => {
	tooltipBox.style.display = "block";
});

tooltipWrapper.addEventListener("mouseleave", () => {
	tooltipBox.style.display = "none";
});
