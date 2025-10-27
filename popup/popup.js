const btn = document.getElementById("summarize-button");
const tabList = document.getElementById("tab-list");
const loadingUI = document.getElementById("loading");
const summaryContainer = document.getElementById("summary-container");
const summaryContent = document.getElementById("summary-content");
const comparisonContainer = document.getElementById("comparison-container");
const comparisonContent = document.getElementById("comparison-content");
const tooltipWarning = document.querySelector(".tool-tip-warning");
const tooltipBoxWarning = document.getElementById("tooltip-box-warning");
const tooltipInfo = document.querySelector(".tool-tip-info");
const tooltipBoxInfo = document.getElementById("tooltip-box-info");

// Load UI
document.addEventListener("DOMContentLoaded", async () => {
	try {
		const tabs = await chrome.tabs.query({ currentWindow: true });
		if (!tabs?.length) {
			tabList.textContent = "No tabs found.";
			return;
		}
		tabList.innerHTML = "";

		const fragment = document.createDocumentFragment();
		tabs.forEach((tab) => {
			const tr = document.createElement("tr");

			// Tab cell
			const titleTd = document.createElement("td");
			const titleDiv = document.createElement("div");
			titleDiv.className = "truncate-multiline";
			titleDiv.textContent = tab.title || "(no title)";
			titleTd.appendChild(titleDiv);
			tr.appendChild(titleTd);

			// Checkbox cell
			const checkboxTd = document.createElement("td");
			const label = document.createElement("label");
			label.className = "checkmark-container";

			const checkbox = document.createElement("input");
			Object.assign(checkbox, {
				type: "checkbox",
				checked: true,
				id: tab.id,
				name: tab.title || "",
			});
			checkbox.className = "checkmark";

			const span = document.createElement("span");
			span.className = "checkmark-inner";

			label.append(checkbox, span);
			checkboxTd.appendChild(label);
			tr.appendChild(checkboxTd);

			fragment.appendChild(tr);
		});
		tabList.appendChild(fragment);
	} catch (err) {
		console.error(err);
		tabList.textContent = "Error loading tabs: " + err.message;
	}
});

// Start summarizing and comparing
btn.addEventListener("click", async () => {
	setLoading(true);
	tooltipWarning.style.display = "none";
	const tooltipList = document.getElementById("tooltip-list");
	tooltipList.innerHTML = "";

	try {
		const tabs = await chrome.tabs.query({ currentWindow: true });
		const checkedTabs = getCheckedTabs(tabs);
		if (!checkedTabs.length) {
			setLoading(false);
			return;
		}

		const summarizer = await createSummarizer();
		const productSummaries = await summarizeTabs(checkedTabs, summarizer, tooltipList);

		if (productSummaries.length) {
			displaySummaries(productSummaries);
			const comparisonResult = await compareProducts(productSummaries);
			console.log(comparisonResult);
			displayComparison(comparisonResult);
		}
	} catch (err) {
		console.error(err);
	} finally {
		setLoading(false);
	}
});

/* Summarization & Comparison Helpers */

function getCheckedTabs(tabs) {
	const tabIds = new Set(tabs.map((t) => String(t.id)));
	return Array.from(document.querySelectorAll('#tab-list input[type="checkbox"]'))
		.filter((cb) => tabIds.has(cb.id) && cb.checked)
		.map((cb) => ({ id: cb.id, title: cb.name }));
}

async function createSummarizer() {
	const context = `You are an e-commerce shopping assistant agent. You specialize in providing complete and concise summaries of products, their reviews and pricing. Your goal is to guide users to purchase products that get them the most value for their money. Resolve the issue efficiently and professionally while reaching your goal. Do not make things up.`;

	const options = { sharedContext: context };
	if ((await Summarizer.availability()) === "unavailable") {
		options.monitor = (m) =>
			m.addEventListener("downloadprogress", (e) =>
				console.log(`Downloaded ${e.loaded * 100}%`)
			);
	}

	return navigator.userActivation.isActive ? Summarizer.create(options) : null;
}

async function summarizeTabs(tabs, summarizer, tooltipList) {
	const productSummaries = [];

	for (const tab of tabs) {
		try {
			await chrome.scripting.executeScript({
				target: { tabId: Number(tab.id) },
				files: ["content.js"],
			});
			const { pageText } = await chrome.tabs.sendMessage(Number(tab.id), {
				action: "extractProduct",
			});
			const summary = summarizer
				? await summarizer.summarize(pageText)
				: "Summarizer unavailable";

			productSummaries.push({ id: tab.id, title: tab.title, extractedSummary: summary });
		} catch (e) {
			// Add warnings to warning tooltip
			tooltipWarning.style.display = "block";
			const li = document.createElement("li");
			li.textContent = `Could not summarize tab "${tab.title}" - ${e}`;
			tooltipList.appendChild(li);
		}
	}

	return productSummaries;
}

function displaySummaries(summaries) {
	summaryContent.innerHTML = summaries
		.map(
			(p, i) => `
		<div class="card">
			<div class="summary-header">Product ${i + 1}</div>
			<div class="summary-body">
				<ul>
					${p.extractedSummary
						.split("\n")
						.map(
							(line) => `<li class="summary-item">${line.replace(/^\*\s*/, "")}</li>`
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

async function compareProducts(productSummaries) {
	const loadingText = document.getElementById("loading-text");
	loadingText.textContent = "Comparing...";

	const initialPrompts = [
		{
			role: "system",
			content: `You are a highly skilled e-commerce shopping assistant agent. You specialize in providing complete and concise comparisons of products, their reviews and pricing. Provide pros and cons with each product presented. Do not make things up.`,
		},
	];

	const options = { initialPrompts: initialPrompts };
	if ((await LanguageModel.availability()) === "unavailable") {
		options.monitor = (m) =>
			m.addEventListener("downloadprogress", (e) =>
				console.log(`Downloaded ${e.loaded * 100}%`)
			);
	}

	const session = await LanguageModel.create(options);
	const productSummariesJson = JSON.stringify(productSummaries);
	return session.prompt(`Compare these products. Products:\n\n${productSummariesJson}`);
}

function displayComparison(result) {
	comparisonContent.innerHTML = marked.parse(result);
	comparisonContainer.style.display = "block";
	scrollToId(comparisonContainer.id);
}

/* UI Helpers */

// Handle resize of table height and styled scroll bar and borders.
window.addEventListener("resize", () => {
	const root = document.documentElement;
	const maxTableHeight = getComputedStyle(root)
		.getPropertyValue("--table-max-height")
		.trim()
		.replace("px", "");

	document.querySelectorAll("table").forEach((table) => {
		if (table.offsetHeight > Number(maxTableHeight)) {
			table.querySelectorAll("td:last-child").forEach((td) => {
				td.style.borderRight = "1px solid var(--border)";
			});
		}
	});
});

function setLoading(isLoading) {
	toggleElementsDisabled(".checkmark", isLoading);
	toggleElementsDisabled(".checkmark-container", isLoading);

	tabList.classList.toggle("disabled", isLoading);
	btn.disabled = isLoading;
	loadingUI.style.display = isLoading ? "flex" : "none";
}

function toggleElementsDisabled(selectors, disabled) {
	document.querySelectorAll(selectors).forEach((el) => {
		el.disabled = disabled;
		el.classList.toggle("disabled", disabled);
	});
}

function scrollToId(id, delay = 100) {
	setTimeout(() => {
		const element = document.getElementById(id);
		if (element) {
			element.scrollIntoView({ behavior: "smooth", block: "start" });
		}
	}, delay);
}

/* Tooltip */

function setupTooltip(trigger, tooltip, delay = 250) {
	let hideTimeout;

	trigger.addEventListener("mouseenter", () => {
		clearTimeout(hideTimeout);
		tooltip.style.display = "block";
	});

	trigger.addEventListener("mouseleave", () => {
		hideTimeout = setTimeout(() => {
			tooltip.style.display = "none";
		}, delay);
	});
}

setupTooltip(tooltipWarning, tooltipBoxWarning);
setupTooltip(tooltipInfo, tooltipBoxInfo);

window.addEventListener("scroll", () => {
	if (window.scrollY > 300) {
		tooltipInfo.classList.add("hidden");
	} else {
		tooltipInfo.classList.remove("hidden");
	}
});
