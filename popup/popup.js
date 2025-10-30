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

		updateLoadingText("Initializing AI models...");
		
		// Check if user gesture is still active
		if (!navigator.userActivation.isActive) {
			throw new Error("User interaction required. Please click the button again.");
		}

		// Create both models upfront while user gesture is active
		// This prevents the gesture from expiring before model creation
		// Using Promise.allSettled to handle partial failures gracefully
		const [summarizerResult, languageModelResult] = await Promise.allSettled([
			createSummarizer(),
			createLanguageModel()
		]);

		const summarizer = summarizerResult.status === 'fulfilled' ? summarizerResult.value : null;
		const languageModelSession = languageModelResult.status === 'fulfilled' ? languageModelResult.value : null;

		if (summarizerResult.status === 'rejected') {
			console.error('Summarizer creation failed:', summarizerResult.reason);
		}
		if (languageModelResult.status === 'rejected') {
			console.error('Language model creation failed:', languageModelResult.reason);
		}

		if (!summarizer) {
			throw new Error("Failed to initialize summarizer. Please try again.");
		}

		if (!languageModelSession) {
			throw new Error("Failed to initialize language model. Please try again.");
		}

		updateLoadingText("Processing product pages...");
		const productSummaries = await summarizeTabs(checkedTabs, summarizer, tooltipList);

		if (productSummaries.length) {
			displaySummaries(productSummaries);
			const comparisonResult = await compareProducts(productSummaries, languageModelSession);
			console.log(comparisonResult);
			displayComparison(comparisonResult);
		} else {
			throw new Error("No products could be processed. Check the warnings for details.");
		}
	} catch (err) {
		console.error('Processing error:', err);
		
		// Show error in tooltip
		tooltipWarning.style.display = "block";
		const li = document.createElement("li");
		li.textContent = `Error: ${err.message}`;
		li.style.color = "#ff4444";
		tooltipList.appendChild(li);
		
		updateLoadingText("Error occurred");
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

	try {
		const availability = await Summarizer.availability();
		console.log('Summarizer availability:', availability);
		
		if (availability === "unavailable") {
			throw new Error("Summarizer is not available on this device");
		}

		const options = { sharedContext: context };
		
		// Add download progress monitoring for downloading/downloadable states
		if (availability === "downloading" || availability === "downloadable") {
			options.monitor = (m) => {
				m.addEventListener("downloadprogress", (e) => {
					const progress = Math.round(e.loaded * 100);
					console.log(`Summarizer download progress: ${progress}%`);
					updateLoadingText(`Downloading AI model... ${progress}%`);
				});
			};
		}

		// Ensure we have user activation before creating the summarizer
		if (!navigator.userActivation.isActive) {
			throw new Error("User gesture required for AI model initialization");
		}

		return await Summarizer.create(options);
	} catch (error) {
		console.error('Failed to create summarizer:', error);
		throw error;
	}
}

async function createLanguageModel() {
	const initialPrompts = [
		{
			role: "system",
			content: `You are a highly skilled e-commerce shopping assistant agent. You specialize in providing complete and concise comparisons of products, their reviews and pricing. Provide pros and cons with each product presented. Do not make things up.`,
		},
	];

	try {
		const availability = await LanguageModel.availability();
		console.log('LanguageModel availability:', availability);
		
		if (availability === "unavailable") {
			throw new Error("Language model is not available on this device");
		}

		const options = { initialPrompts: initialPrompts };
		
		// Add download progress monitoring for downloading/downloadable states
		if (availability === "downloading" || availability === "downloadable") {
			options.monitor = (m) => {
				m.addEventListener("downloadprogress", (e) => {
					const progress = Math.round(e.loaded * 100);
					console.log(`Language model download progress: ${progress}%`);
					updateLoadingText(`Downloading comparison model... ${progress}%`);
				});
			};
		}

		// Ensure we have user activation before creating the language model
		if (!navigator.userActivation.isActive) {
			throw new Error("User gesture required for AI model initialization");
		}

		return await LanguageModel.create(options);
	} catch (error) {
		console.error('Failed to create language model:', error);
		throw error;
	}
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
			let summary;
			if (summarizer) {
				try {
					summary = await summarizer.summarize(pageText);
				} catch (summaryError) {
					console.error('Summarization error:', summaryError);
					summary = `Error summarizing: ${summaryError.message}`;
				}
			} else {
				summary = "Summarizer unavailable";
			}

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

async function compareProducts(productSummaries, languageModelSession) {
	updateLoadingText("Comparing products...");

	try {
		if (!languageModelSession) {
			throw new Error("Language model session is not available");
		}

		const productSummariesJson = JSON.stringify(productSummaries);
		return await languageModelSession.prompt(`Compare these products. Products:\n\n${productSummariesJson}`);
	} catch (error) {
		console.error('Failed to compare products:', error);
		throw error;
	}
}

function displayComparison(result) {
	comparisonContent.innerHTML = marked.parse(result);
	comparisonContainer.style.display = "block";
	scrollToId(comparisonContainer.id);
}

/* UI Helpers */

function updateLoadingText(text) {
	const loadingText = document.getElementById("loading-text");
	if (loadingText) {
		loadingText.textContent = text;
	}
}

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
