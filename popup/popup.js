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

// Store current product summaries and comparison result for export functions
let currentProductSummaries = null;
let currentComparisonResult = null;

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
	resetScrollInterruption(); // Reset scroll flag for new task
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
			createLanguageModel(),
		]);

		const summarizer = summarizerResult.status === "fulfilled" ? summarizerResult.value : null;
		const languageModelSession =
			languageModelResult.status === "fulfilled" ? languageModelResult.value : null;

		if (summarizerResult.status === "rejected") {
			console.error("Summarizer creation failed:", summarizerResult.reason);
		}
		if (languageModelResult.status === "rejected") {
			console.error("Language model creation failed:", languageModelResult.reason);
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
			// Store for export functions
			currentProductSummaries = productSummaries;
			displaySummaries(productSummaries);
			const comparisonResult = await compareProducts(productSummaries, languageModelSession);
			console.log(comparisonResult);
			currentComparisonResult = comparisonResult;
			displayComparison(comparisonResult, productSummaries);
		} else {
			throw new Error("No products could be processed. Check the warnings for details.");
		}
	} catch (err) {
		console.error("Processing error:", err);

		// Show error in tooltip
		tooltipWarning.style.display = "block";
		const li = document.createElement("li");
		li.textContent = `Error: ${err.message}`;
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
		console.log("Summarizer availability:", availability);

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
		console.error("Failed to create summarizer:", error);
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
		console.log("LanguageModel availability:", availability);

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
		console.error("Failed to create language model:", error);
		throw error;
	}
}

async function summarizeTabs(tabs, summarizer, tooltipList) {
	const productSummaries = [];

	for (let i = 0; i < tabs.length; i++) {
		const tab = tabs[i];
		try {
			updateLoadingText(`Processing product ${i + 1} of ${tabs.length}...`);

			await chrome.scripting.executeScript({
				target: { tabId: Number(tab.id) },
				files: ["content.js"],
			});
			const { pageText, productData } = await chrome.tabs.sendMessage(Number(tab.id), {
				action: "extractProduct",
			});

			let summary;
			if (summarizer) {
				try {
					// Try streaming summarization
					summary = await streamSummarization(summarizer, pageText, i, tabs.length);
				} catch (summaryError) {
					console.error("Summarization error:", summaryError);
					// Fallback to non-streaming
					try {
						summary = await summarizer.summarize(pageText);
					} catch (fallbackError) {
						summary = `Error summarizing: ${summaryError.message}`;
					}
				}
			} else {
				summary = "Summarizer unavailable";
			}

			// Calculate value score and track price
			const valueScore = calculateValueScore(productData);
			const priceAlert = await trackPrice(productData);

			productSummaries.push({
				id: tab.id,
				title: tab.title,
				extractedSummary: summary,
				productData: productData,
				valueScore: valueScore,
				priceAlert: priceAlert,
			});

			// Update display as we go
			if (productSummaries.length > 0) {
				displaySummaries(productSummaries);
			}
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

async function streamSummarization(summarizer, pageText, index, total) {
	let fullSummary = "";

	try {
		// Chrome's Summarizer.summarize() may support streaming
		const response = await summarizer.summarize(pageText, { stream: true });

		// Check if response is a stream
		if (response && typeof response.getReader === "function") {
			// It's a ReadableStream
			const reader = response.getReader();
			const decoder = new TextDecoder();

			while (true) {
				const { done, value } = await reader.read();

				if (done) break;

				const chunk = decoder.decode(value, { stream: true });
				fullSummary += chunk;

				updateLoadingText(
					`Summarizing product ${index + 1}/${total}... (${fullSummary.length} chars)`
				);
			}

			return fullSummary;
		} else if (response && typeof response.then === "function") {
			// It's a promise, await it
			return await response;
		} else {
			// Direct response
			return response;
		}
	} catch (error) {
		// If streaming fails, try regular summarize
		console.log("Streaming not available, using regular summarize:", error);
		try {
			const result = await summarizer.summarize(pageText);
			return result;
		} catch (fallbackError) {
			throw fallbackError;
		}
	}
}

function displaySummaries(summaries) {
	summaryContent.innerHTML = summaries
		.map((p, i) => {
			const valueScoreBadge =
				p.valueScore !== null
					? `<div class="value-score-badge score-${getScoreCategory(p.valueScore)}">
							<span class="value-score-label">Value Score:</span>
							<span class="value-score-value">${p.valueScore.toFixed(1)}/10</span>
						</div>`
					: "";

			const priceInfo =
				p.productData && p.productData.price
					? `<div class="price-info">
							<span class="price-value">${formatPrice(p.productData.price, p.productData.currency)}</span>
							${
								p.priceAlert
									? `<span class="price-alert ${p.priceAlert.type}">${p.priceAlert.message}</span>`
									: ""
							}
						</div>`
					: "";

			const ratingInfo =
				p.productData && p.productData.rating
					? `<div class="rating-info">
							⭐ ${p.productData.rating.toFixed(1)}${
							p.productData.reviewCount
								? ` (${formatReviewCount(p.productData.reviewCount)} reviews)`
								: ""
					  }
						</div>`
					: "";

			return `
			<div class="card">
				<div class="summary-header">
					<div class="product-header-top">
						<span>Product ${i + 1}</span>
						${valueScoreBadge}
					</div>
					${priceInfo}
					${ratingInfo}
				</div>
				<div class="summary-body">
					<ul>
						${p.extractedSummary
							.split("\n")
							.filter((line) => line.trim())
							.map(
								(line) =>
									`<li class="summary-item">${line.replace(/^\*\s*/, "")}</li>`
							)
							.join("")}
					</ul>
				</div>
			</div>`;
		})
		.join("");
	summaryContainer.style.display = "block";
	scrollToId(loadingUI.id);
}

async function compareProducts(productSummaries, languageModelSession) {
	updateLoadingText("Comparing products...");

	try {
		if (!languageModelSession) {
			throw new Error("Language model session is not available");
		}

		const productSummariesJson = JSON.stringify(productSummaries);
		const prompt = `Compare these products. Products:\n\n${productSummariesJson}`;

		// Stream the comparison
		return await streamComparison(languageModelSession, prompt);
	} catch (error) {
		console.error("Failed to compare products:", error);
		throw error;
	}
}

async function streamComparison(session, prompt) {
	let fullComparison = "";

	try {
		// Try promptStreaming() if available (Chrome's streaming API)
		if (session.promptStreaming) {
			const stream = session.promptStreaming(prompt);

			// Show container immediately
			comparisonContainer.style.display = "block";
			comparisonContent.innerHTML = "<p>Comparing products...</p>";

			// Handle async iterator
			for await (const chunk of stream) {
				fullComparison += chunk;

				// Update UI in real-time as comparison streams
				const comparisonHTML = marked.parse(
					fullComparison + '<span class="streaming-cursor">▋</span>'
				);
				comparisonContent.innerHTML = comparisonHTML;

				updateLoadingText(`Comparing... (${fullComparison.length} chars)`);
				scrollToId(loadingUI.id);
			}

			// Final render without cursor
			const comparisonHTML = marked.parse(fullComparison);
			comparisonContent.innerHTML = comparisonHTML;
			return fullComparison;
		}

		// Fallback: Try ReadableStream approach
		const response = await session.prompt(prompt, { stream: true });

		// Check if response is a stream
		if (response && typeof response.getReader === "function") {
			const reader = response.getReader();
			const decoder = new TextDecoder();

			comparisonContainer.style.display = "block";
			comparisonContent.innerHTML = "<p>Comparing products...</p>";

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				const chunk = decoder.decode(value, { stream: true });
				fullComparison += chunk;

				const comparisonHTML = marked.parse(
					fullComparison + '<span class="streaming-cursor">▋</span>'
				);
				comparisonContent.innerHTML = comparisonHTML;
				updateLoadingText(`Comparing... (${fullComparison.length} chars)`);
			}

			const comparisonHTML = marked.parse(fullComparison);
			comparisonContent.innerHTML = comparisonHTML;
			return fullComparison;
		}

		// If no streaming support, use regular prompt
		return await (response && typeof response.then === "function"
			? response
			: session.prompt(prompt));
	} catch (error) {
		// Final fallback: regular prompt
		console.log("Streaming not available, using regular prompt:", error);
		try {
			const result = await session.prompt(prompt);
			return result;
		} catch (fallbackError) {
			throw fallbackError;
		}
	}
}

function displayComparison(result, productSummaries) {
	const comparisonHTML = marked.parse(result);
	const exportButtons = `
		<div class="export-buttons" id="export-buttons-container">
			<button id="export-text-btn" class="export-btn">📋 Copy as Text</button>
			<button id="export-json-btn" class="export-btn">💾 Export JSON</button>
			<button id="share-comparison-btn" class="export-btn">🔗 Share</button>
			<button id="generate-webpage-btn" class="export-btn">🌐 Generate Webpage</button>
		</div>
	`;

	comparisonContent.innerHTML = comparisonHTML + exportButtons;
	comparisonContainer.style.display = "block";

	// Add event listeners for export buttons
	setupExportButtons(result, productSummaries);
	scrollToId("export-buttons-container");
}

/* Feature 1: Smart Value Score Calculator */
function calculateValueScore(productData) {
	if (!productData) return null;

	let score = 5.0; // Base score

	// Price factor (lower price = higher score, normalized)
	if (productData.price) {
		// Normalize price (assuming typical range $10-$1000)
		const normalizedPrice = Math.max(0, Math.min(1, (1000 - productData.price) / 990));
		score += normalizedPrice * 2.0; // Price contributes up to 2 points
	}

	// Rating factor (0-5 stars -> contributes up to 3 points)
	if (productData.rating) {
		score += (productData.rating / 5) * 3.0;
	}

	// Review count factor (more reviews = more reliable)
	if (productData.reviewCount) {
		const reviewFactor = Math.min(1, Math.log10(productData.reviewCount + 1) / 4); // Log scale
		score += reviewFactor * 1.0; // Reviews contribute up to 1 point
	}

	// Cap score at 10
	return Math.min(10, Math.max(0, score));
}

function getScoreCategory(score) {
	if (score >= 8) return "excellent";
	if (score >= 6) return "good";
	if (score >= 4) return "fair";
	return "poor";
}

/* Feature 2: Price Drop Alerts & History Tracking */
async function trackPrice(productData) {
	if (!productData || !productData.price || !productData.url) {
		return null;
	}

	try {
		const storageKey = `price_history_${productData.url}`;
		const stored = await chrome.storage.local.get([storageKey]);
		const history = stored[storageKey] || { prices: [], lastPrice: null, lastUpdate: null };

		const currentPrice = productData.price;
		const priceDropThreshold = 0.1; // 10% drop triggers alert
		const alert = { type: "", message: "" };

		if (history.lastPrice && history.lastPrice > currentPrice) {
			const priceDrop = ((history.lastPrice - currentPrice) / history.lastPrice) * 100;

			if (priceDrop >= priceDropThreshold * 100) {
				alert.type = "drop";
				alert.message = `💰 Price dropped ${priceDrop.toFixed(1)}%!`;
			}
		} else if (history.lastPrice && history.lastPrice < currentPrice) {
			const priceIncrease = ((currentPrice - history.lastPrice) / history.lastPrice) * 100;
			if (priceIncrease >= priceDropThreshold * 100) {
				alert.type = "increase";
				alert.message = `📈 Price increased ${priceIncrease.toFixed(1)}%`;
			}
		}

		// Update history
		history.prices.push({
			price: currentPrice,
			currency: productData.currency,
			timestamp: Date.now(),
		});

		// Keep only last 30 days of history
		const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
		history.prices = history.prices.filter((p) => p.timestamp > thirtyDaysAgo);

		history.lastPrice = currentPrice;
		history.lastUpdate = Date.now();

		await chrome.storage.local.set({ [storageKey]: history });

		return alert.type ? alert : null;
	} catch (error) {
		console.error("Price tracking error:", error);
		return null;
	}
}

/* Feature 3: Export & Share Comparisons */
function setupExportButtons(comparisonText, productSummaries) {
	const exportTextBtn = document.getElementById("export-text-btn");
	const exportJsonBtn = document.getElementById("export-json-btn");
	const shareBtn = document.getElementById("share-comparison-btn");
	const generateWebpageBtn = document.getElementById("generate-webpage-btn");

	if (exportTextBtn) {
		exportTextBtn.addEventListener("click", () => {
			if (!currentProductSummaries || !currentComparisonResult) {
				console.error("Product summaries or comparison result not available");
				showExportNotification("❌ Export data not available");
				return;
			}
			exportAsText(currentComparisonResult, currentProductSummaries);
		});
	}

	if (exportJsonBtn) {
		exportJsonBtn.addEventListener("click", () => {
			if (!currentProductSummaries) {
				console.error("Product summaries not available");
				showExportNotification("❌ Export data not available");
				return;
			}
			exportAsJSON(currentProductSummaries);
		});
	}

	if (shareBtn) {
		shareBtn.addEventListener("click", () => {
			if (!currentProductSummaries || !currentComparisonResult) {
				console.error("Product summaries or comparison result not available");
				showExportNotification("❌ Share data not available");
				return;
			}
			shareComparison(currentComparisonResult, currentProductSummaries);
		});
	}

	if (generateWebpageBtn) {
		generateWebpageBtn.addEventListener("click", async () => {
			if (!currentProductSummaries || !currentComparisonResult) {
				console.error("Product summaries or comparison result not available");
				showExportNotification("❌ Data not available for webpage generation");
				return;
			}
			showExportNotification("🎨 Generating custom webpage...");
			await generateComparisonWebpage(currentComparisonResult, currentProductSummaries);
		});
	}
}

async function exportAsText(comparisonText, productSummaries) {
	if (!productSummaries || !Array.isArray(productSummaries)) {
		console.error("Invalid productSummaries:", productSummaries);
		showExportNotification("❌ No data to export");
		return;
	}

	const text =
		`Smart Shopper Comparison Report\n` +
		`Generated: ${new Date().toLocaleString()}\n\n` +
		`=== PRODUCT SUMMARIES ===\n\n` +
		productSummaries
			.map((p, i) => {
				let text = `Product ${i + 1}: ${p.title || "Unknown"}\n`;
				if (p.productData) {
					if (p.productData.price) {
						text += `Price: ${formatPrice(
							p.productData.price,
							p.productData.currency
						)}\n`;
					}
					if (p.productData.rating) {
						text += `Rating: ${p.productData.rating.toFixed(1)}/5`;
						if (p.productData.reviewCount) {
							text += ` (${p.productData.reviewCount} reviews)`;
						}
						text += "\n";
					}
					if (p.valueScore !== null) {
						text += `Value Score: ${p.valueScore.toFixed(1)}/10\n`;
					}
					if (p.priceAlert) {
						text += `${p.priceAlert.message}\n`;
					}
				}
				text += `\n${p.extractedSummary}\n\n`;
				return text;
			})
			.join("---\n\n") +
		`\n=== COMPARISON ===\n\n${comparisonText}`;

	await navigator.clipboard.writeText(text);
	showExportNotification("✅ Comparison copied to clipboard!");
}

function exportAsJSON(productSummaries) {
	if (!productSummaries || !Array.isArray(productSummaries)) {
		console.error("Invalid productSummaries:", productSummaries);
		showExportNotification("❌ No data to export");
		return;
	}

	const data = {
		generated: new Date().toISOString(),
		products: productSummaries.map((p) => ({
			title: p.title,
			summary: p.extractedSummary,
			productData: p.productData,
			valueScore: p.valueScore,
			priceAlert: p.priceAlert,
		})),
	};

	const jsonStr = JSON.stringify(data, null, 2);
	const blob = new Blob([jsonStr], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `smart-shopper-comparison-${Date.now()}.json`;
	a.click();
	URL.revokeObjectURL(url);
	showExportNotification("✅ JSON file downloaded!");
}

async function shareComparison(comparisonText, productSummaries) {
	if (!productSummaries || !Array.isArray(productSummaries)) {
		console.error("Invalid productSummaries:", productSummaries);
		showExportNotification("❌ No data to share");
		return;
	}

	const summary = productSummaries
		.map((p, i) => {
			let text = `${i + 1}. ${p.title || "Product"}`;
			if (p.valueScore !== null) {
				text += ` (Value: ${p.valueScore.toFixed(1)}/10)`;
			}
			return text;
		})
		.join("\n");

	const shareText = `🏪 Smart Shopper Comparison\n\n${summary}\n\nSee full comparison in Smart Shopper extension.`;

	if (navigator.share) {
		try {
			await navigator.share({
				title: "Smart Shopper Comparison",
				text: shareText,
			});
			showExportNotification("✅ Shared successfully!");
		} catch (error) {
			// User cancelled or share failed
			console.log("Share cancelled:", error);
		}
	} else {
		// Fallback: copy to clipboard
		await navigator.clipboard.writeText(shareText);
		showExportNotification("✅ Comparison link copied to clipboard!");
	}
}

function showExportNotification(message) {
	const notification = document.createElement("div");
	notification.className = "export-notification";
	notification.textContent = message;
	document.body.appendChild(notification);

	setTimeout(() => {
		notification.classList.add("show");
	}, 10);

	setTimeout(() => {
		notification.classList.remove("show");
		setTimeout(() => notification.remove(), 300);
	}, 2000);
}

/* Streaming helper functions */
async function openSelfContainedWebpageTab(embeddedData) {
	// Use extension page URL so it has access to LanguageModel API
	const extensionUrl = chrome.runtime.getURL('webpage-generator.html');
	
	// Encode data in URL hash (supports large data)
	const dataString = JSON.stringify(embeddedData);
	const urlWithData = extensionUrl + '#' + encodeURIComponent(dataString);
	
	// Get current window and open tab there
	try {
		const currentWindow = await chrome.windows.getCurrent();
		const tab = await chrome.tabs.create({
			url: urlWithData,
			active: true,
			windowId: currentWindow.id
		});
		return tab;
	} catch (error) {
		// Fallback to new window
		const window = await chrome.windows.create({
			url: urlWithData,
			type: 'normal',
			focused: true,
			width: 1200,
			height: 800
		});
		// Get the tab from the window
		const tabs = await chrome.tabs.query({ windowId: window.id });
		return tabs[0];
	}
}


async function streamWebpageGenerationIntoTab(session, prompt, tabId, productSummaries) {
	let fullHTML = '';
	let lastUpdateTime = 0;
	const UPDATE_INTERVAL = 100; // Update tab every 100ms to avoid too frequent updates
	
	try {
		// Try promptStreaming() if available (Chrome's streaming API)
		if (session.promptStreaming) {
			const stream = session.promptStreaming(prompt);
			
			// Handle async iterator
			for await (const chunk of stream) {
				fullHTML += chunk;
				
				// Update tab periodically (not on every chunk to avoid performance issues)
				const now = Date.now();
				if (now - lastUpdateTime > UPDATE_INTERVAL || fullHTML.length < 500) {
					await updateTabContent(tabId, fullHTML, fullHTML.length);
					lastUpdateTime = now;
				}
				
				updateLoadingText(`Generating HTML... (${fullHTML.length} chars)`);
			}
			
			// Final update with complete HTML
			await updateTabContent(tabId, fullHTML, fullHTML.length);
			showExportNotification("✅ Custom webpage generated!");
			return fullHTML;
		}
		
		// Fallback: Try ReadableStream approach
		const response = await session.prompt(prompt, { stream: true });
		
		if (response && typeof response.getReader === 'function') {
			const reader = response.getReader();
			const decoder = new TextDecoder();
			
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				
				const chunk = decoder.decode(value, { stream: true });
				fullHTML += chunk;
				
				// Update tab periodically
				const now = Date.now();
				if (now - lastUpdateTime > UPDATE_INTERVAL || fullHTML.length < 500) {
					await updateTabContent(tabId, fullHTML, fullHTML.length);
					lastUpdateTime = now;
				}
				
				updateLoadingText(`Generating HTML... (${fullHTML.length} chars)`);
			}
			
			// Final update
			await updateTabContent(tabId, fullHTML, fullHTML.length);
			showExportNotification("✅ Custom webpage generated!");
			return fullHTML;
		}
		
		// If no streaming support, use regular prompt but still update tab
		const result = await (response && typeof response.then === 'function' ? response : session.prompt(prompt));
		
		// Clean up result if needed
		let htmlContent = typeof result === 'string' ? result : String(result);
		htmlContent = htmlContent.trim();
		
		// Remove markdown code blocks if present
		htmlContent = htmlContent.replace(/^```html\s*/i, '');
		htmlContent = htmlContent.replace(/^```\s*/i, '');
		htmlContent = htmlContent.replace(/\s*```$/i, '');
		htmlContent = htmlContent.trim();
		
		// Validate HTML
		if (!htmlContent.toLowerCase().startsWith('<!doctype html') && 
			!htmlContent.toLowerCase().startsWith('<html')) {
			htmlContent = createFallbackWebpage(productSummaries);
		}
		
		await updateTabContent(tabId, htmlContent, htmlContent.length);
		showExportNotification("✅ Custom webpage generated!");
		return htmlContent;
	} catch (error) {
		// Final fallback: regular prompt
		console.log('Streaming not available, using regular prompt:', error);
		try {
			const result = await session.prompt(prompt);
			
			// Clean and validate
			let htmlContent = typeof result === 'string' ? result : String(result);
			htmlContent = htmlContent.trim();
			htmlContent = htmlContent.replace(/^```html\s*/i, '');
			htmlContent = htmlContent.replace(/^```\s*/i, '');
			htmlContent = htmlContent.replace(/\s*```$/i, '');
			htmlContent = htmlContent.trim();
			
			if (!htmlContent.toLowerCase().startsWith('<!doctype html') && 
				!htmlContent.toLowerCase().startsWith('<html')) {
				htmlContent = createFallbackWebpage(productSummaries);
			}
			
			await updateTabContent(tabId, htmlContent, htmlContent.length);
			showExportNotification("✅ Custom webpage generated!");
			return htmlContent;
		} catch (fallbackError) {
			// Use fallback template
			const fallbackHTML = createFallbackWebpage(productSummaries);
			await updateTabContent(tabId, fallbackHTML, fallbackHTML.length);
			showExportNotification("✅ Custom webpage generated (using template)!");
			return fallbackHTML;
		}
	}
}

async function updateTabContent(tabId, html, charCount) {
	try {
		// Data URLs don't have access to Chrome extension APIs
		// So we'll update the tab URL directly with the HTML content
		
		// For partial HTML, create a preview version with progress indicator
		let htmlToDisplay = html;
		if (html.length > 0 && (!html.toLowerCase().includes('</html>') || html.length < 1000)) {
			// Create preview version showing what's been generated so far
			htmlToDisplay = createPreviewHTML(html, charCount);
		} else {
			// Clean up complete HTML
			let cleanedHTML = html.trim();
			
			// Remove markdown code blocks if present
			cleanedHTML = cleanedHTML.replace(/^```html\s*/i, '');
			cleanedHTML = cleanedHTML.replace(/^```\s*/i, '');
			cleanedHTML = cleanedHTML.replace(/\s*```$/i, '');
			cleanedHTML = cleanedHTML.trim();
			
			htmlToDisplay = cleanedHTML;
		}
		
		// Update tab URL with the HTML content
		const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlToDisplay);
		await chrome.tabs.update(tabId, { url: dataUrl });
	} catch (error) {
		console.error('Error updating tab content:', error);
		// Fallback: update tab URL directly
		const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
		await chrome.tabs.update(tabId, { url: dataUrl });
	}
}

function createPreviewHTML(partialHTML, charCount) {
	// If we have enough HTML to be meaningful, show it
	if (partialHTML.toLowerCase().includes('<!doctype html') || partialHTML.toLowerCase().includes('<html')) {
		return partialHTML + `
		<style>
			.streaming-overlay {
				position: fixed;
				bottom: 20px;
				right: 20px;
				background: rgba(102, 126, 234, 0.9);
				color: white;
				padding: 15px 20px;
				border-radius: 10px;
				box-shadow: 0 4px 12px rgba(0,0,0,0.3);
				font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
				font-size: 14px;
				z-index: 10000;
			}
			.streaming-indicator {
				display: inline-block;
				width: 8px;
				height: 8px;
				background: white;
				border-radius: 50%;
				margin-right: 8px;
				animation: pulse 1.5s ease-in-out infinite;
			}
			@keyframes pulse {
				0%, 100% { opacity: 1; }
				50% { opacity: 0.3; }
			}
		</style>
		<div class="streaming-overlay">
			<span class="streaming-indicator"></span>
			Generating... ${charCount} characters
		</div>`;
	}
	
	// Otherwise show loading screen with progress
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Generating Comparison... - Smart Shopper</title>
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			min-height: 100vh;
			display: flex;
			align-items: center;
			justify-content: center;
			color: white;
		}
		.loading-container {
			text-align: center;
		}
		.spinner {
			border: 4px solid rgba(255,255,255,0.3);
			border-top: 4px solid white;
			border-radius: 50%;
			width: 50px;
			height: 50px;
			animation: spin 1s linear infinite;
			margin: 0 auto 20px;
		}
		@keyframes spin {
			0% { transform: rotate(0deg); }
			100% { transform: rotate(360deg); }
		}
		.loading-text {
			font-size: 18px;
			font-weight: 600;
			margin-bottom: 10px;
		}
		.char-count {
			font-size: 14px;
			opacity: 0.9;
		}
		.progress-bar {
			width: 300px;
			height: 4px;
			background: rgba(255,255,255,0.3);
			border-radius: 2px;
			margin: 20px auto;
			overflow: hidden;
		}
		.progress-fill {
			height: 100%;
			background: white;
			border-radius: 2px;
			transition: width 0.3s ease;
		}
	</style>
</head>
<body>
	<div class="loading-container">
		<div class="spinner"></div>
		<div class="loading-text">🎨 Generating your comparison webpage...</div>
		<div class="char-count">${charCount} characters generated</div>
		<div class="progress-bar">
			<div class="progress-fill" style="width: ${Math.min(100, (charCount / 5000) * 100)}%"></div>
		</div>
	</div>
</body>
</html>`;
}

/* Feature 4: Generate Custom Comparison Webpage with LLM */
async function generateComparisonWebpage(comparisonText, productSummaries) {
	try {
		updateLoadingText("Designing custom webpage...");

		// Check if language model is available
		if ((await LanguageModel.availability()) === "unavailable") {
			throw new Error("Language model not available for webpage generation");
		}

		// Prepare product data for the LLM
		const productData = productSummaries.map((p, i) => ({
			number: i + 1,
			title: p.title || `Product ${i + 1}`,
			summary: p.extractedSummary,
			price: p.productData?.price
				? formatPrice(p.productData.price, p.productData.currency)
				: null,
			rating: p.productData?.rating ? `${p.productData.rating.toFixed(1)}/5` : null,
			reviewCount: p.productData?.reviewCount
				? formatReviewCount(p.productData.reviewCount)
				: null,
			valueScore: p.valueScore !== null ? p.valueScore.toFixed(1) : null,
			priceAlert: p.priceAlert?.message || null,
		}));

		const prompt = `Create a beautiful, modern, responsive HTML webpage that displays a product comparison. 

REQUIREMENTS:
1. Create a complete, standalone HTML document (with <!DOCTYPE html>, <html>, <head>, <body> tags)
2. Include all CSS inline in a <style> tag in the <head>
3. Make it visually appealing with modern design (gradients, shadows, smooth animations)
4. Use a professional color scheme (blues, greens, grays)
5. Make it responsive for different screen sizes
6. Include the following sections:
   - Header with title "Product Comparison" and generation date
   - Product cards showing each product with:
     * Product title
     * Price (if available)
     * Rating and review count (if available)
     * Value score badge (if available, color-coded: green for 8+, blue for 6-8, yellow for 4-6, red for <4)
     * Price alerts (if available, styled appropriately)
     * Summary text
   - Comparison section with the AI-generated comparison text
7. Use modern CSS features (flexbox, grid, animations, gradients)
8. Make product cards visually distinct with hover effects
9. Format the comparison text nicely with proper typography

PRODUCT DATA:
${JSON.stringify(productData, null, 2)}

COMPARISON TEXT:
${comparisonText}

Generate ONLY the complete HTML code, starting with <!DOCTYPE html>. Do not include any markdown formatting or code blocks. Return pure HTML.`;

		// Get or create a language model session
		const initialPrompts = [
			{
				role: "system",
				content: `You are an expert web designer specializing in creating beautiful, modern, responsive HTML webpages. You generate complete, standalone HTML documents with inline CSS that are production-ready and visually stunning.`,
			},
		];

		const options = { initialPrompts: initialPrompts };

		// Check availability and add monitor if needed
		const availability = await LanguageModel.availability();
		if (availability === "downloading" || availability === "downloadable") {
			options.monitor = (m) => {
				m.addEventListener("downloadprogress", (e) => {
					const progress = Math.round(e.loaded * 100);
					updateLoadingText(`Downloading model... ${progress}%`);
				});
			};
		}

		// Prepare data to embed in the self-contained page
		const embeddedData = {
			prompt: prompt,
			productSummaries: productSummaries,
			comparisonText: comparisonText,
			initialPrompts: initialPrompts,
			fallbackWebpageHTML: createFallbackWebpage(productSummaries)
		};
		
		// Open tab immediately with self-contained generation page
		const tab = await openSelfContainedWebpageTab(embeddedData);
		showExportNotification("✅ Webpage tab opened! Generating...");
		updateLoadingText("Tab generating webpage...");
	} catch (error) {
		console.error("Failed to generate webpage:", error);
		showExportNotification(`❌ Error: ${error.message}`);
		updateLoadingText("Error occurred");
	}
}

async function openComparisonWebpage(htmlContent, productSummaries) {
	try {
		updateLoadingText("Opening webpage...");
		
		// Clean up the HTML content (remove markdown code blocks if present)
		let cleanedHTML = htmlContent.trim();
		
		// Remove markdown code block wrappers if present
		cleanedHTML = cleanedHTML.replace(/^```html\s*/i, '');
		cleanedHTML = cleanedHTML.replace(/^```\s*/i, '');
		cleanedHTML = cleanedHTML.replace(/\s*```$/i, '');
		cleanedHTML = cleanedHTML.trim();
		
		// Validate that it starts with HTML
		if (!cleanedHTML.toLowerCase().startsWith('<!doctype html') && 
			!cleanedHTML.toLowerCase().startsWith('<html')) {
			// If LLM didn't generate proper HTML, create a fallback template
			cleanedHTML = createFallbackWebpage(productSummaries);
		}
		
		// Create a data URL
		const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(cleanedHTML);
		
		// Get the current window to open tab in the same window
		try {
			const currentWindow = await chrome.windows.getCurrent();
			
			// Try to open in the current window first
			const tab = await chrome.tabs.create({
				url: dataUrl,
				active: true,
				windowId: currentWindow.id
			});
			
			showExportNotification("✅ Custom webpage opened!");
			updateLoadingText("Webpage generated");
		} catch (tabError) {
			// If that fails, try opening a new window
			console.log("Failed to open in current window, trying new window:", tabError);
			
			const window = await chrome.windows.create({
				url: dataUrl,
				type: 'normal',
				focused: true,
				width: 1200,
				height: 800
			});
			
			showExportNotification("✅ Custom webpage opened in new window!");
			updateLoadingText("Webpage generated");
		}
	} catch (error) {
		console.error('Failed to open webpage:', error);
		
		// Last resort: try using window.open() as fallback
		try {
			// Ensure we have cleanedHTML
			let cleanedHTML = htmlContent.trim();
			cleanedHTML = cleanedHTML.replace(/^```html\s*/i, '');
			cleanedHTML = cleanedHTML.replace(/^```\s*/i, '');
			cleanedHTML = cleanedHTML.replace(/\s*```$/i, '');
			cleanedHTML = cleanedHTML.trim();
			
			if (!cleanedHTML.toLowerCase().startsWith('<!doctype html') && 
				!cleanedHTML.toLowerCase().startsWith('<html')) {
				cleanedHTML = createFallbackWebpage(productSummaries);
			}
			
			const blob = new Blob([cleanedHTML], { type: 'text/html' });
			const blobUrl = URL.createObjectURL(blob);
			window.open(blobUrl, '_blank');
			showExportNotification("✅ Webpage opened via fallback method!");
		} catch (fallbackError) {
			console.error('Fallback method also failed:', fallbackError);
			showExportNotification(`❌ Could not open webpage. Error: ${error.message}`);
		}
	}
}

function createFallbackWebpage(productSummaries) {
	const comparisonText = currentComparisonResult || "Comparison details not available.";
	const generatedDate = new Date().toLocaleString();

	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Product Comparison - Smart Shopper</title>
	<style>
		* {
			margin: 0;
			padding: 0;
			box-sizing: border-box;
		}
		body {
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			min-height: 100vh;
			padding: 20px;
			color: #333;
		}
		.container {
			max-width: 1200px;
			margin: 0 auto;
		}
		.header {
			background: white;
			padding: 30px;
			border-radius: 15px;
			box-shadow: 0 10px 30px rgba(0,0,0,0.2);
			margin-bottom: 30px;
			text-align: center;
		}
		.header h1 {
			font-size: 2.5em;
			margin-bottom: 10px;
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			-webkit-background-clip: text;
			-webkit-text-fill-color: transparent;
			background-clip: text;
		}
		.header p {
			color: #666;
			font-size: 0.9em;
		}
		.products-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
			gap: 20px;
			margin-bottom: 30px;
		}
		.product-card {
			background: white;
			border-radius: 15px;
			padding: 25px;
			box-shadow: 0 5px 20px rgba(0,0,0,0.1);
			transition: transform 0.3s ease, box-shadow 0.3s ease;
		}
		.product-card:hover {
			transform: translateY(-5px);
			box-shadow: 0 10px 30px rgba(0,0,0,0.2);
		}
		.product-header {
			border-bottom: 2px solid #f0f0f0;
			padding-bottom: 15px;
			margin-bottom: 15px;
		}
		.product-title {
			font-size: 1.3em;
			font-weight: 600;
			margin-bottom: 10px;
			color: #333;
		}
		.product-info {
			display: flex;
			flex-wrap: wrap;
			gap: 15px;
			margin-bottom: 15px;
		}
		.info-item {
			font-size: 0.9em;
		}
		.price {
			color: #667eea;
			font-weight: 700;
			font-size: 1.2em;
		}
		.rating {
			color: #ff9800;
		}
		.value-score {
			display: inline-block;
			padding: 4px 12px;
			border-radius: 20px;
			font-size: 0.85em;
			font-weight: 600;
		}
		.value-score.excellent { background: #1da462; color: white; }
		.value-score.good { background: #4c8bf5; color: white; }
		.value-score.fair { background: #ffcd46; color: #333; }
		.value-score.poor { background: #dd5144; color: white; }
		.price-alert {
			display: inline-block;
			padding: 4px 10px;
			border-radius: 12px;
			font-size: 0.85em;
			font-weight: 600;
			margin-top: 5px;
		}
		.price-alert.drop {
			background: #e8f5e9;
			color: #1da462;
		}
		.product-summary {
			color: #666;
			line-height: 1.6;
			font-size: 0.95em;
		}
		.comparison-section {
			background: white;
			border-radius: 15px;
			padding: 30px;
			box-shadow: 0 5px 20px rgba(0,0,0,0.1);
		}
		.comparison-section h2 {
			font-size: 1.8em;
			margin-bottom: 20px;
			color: #333;
		}
		.comparison-content {
			line-height: 1.8;
			color: #555;
			white-space: pre-wrap;
		}
		@media (max-width: 768px) {
			.products-grid {
				grid-template-columns: 1fr;
			}
			.header h1 {
				font-size: 2em;
			}
		}
	</style>
</head>
<body>
	<div class="container">
		<div class="header">
			<h1>🏪 Product Comparison</h1>
			<p>Generated on ${generatedDate}</p>
		</div>
		
		<div class="products-grid">
			${productSummaries
				.map((p, i) => {
					const valueScoreCategory =
						p.valueScore !== null ? getScoreCategory(p.valueScore) : "";
					return `
				<div class="product-card">
					<div class="product-header">
						<div class="product-title">Product ${i + 1}: ${p.title || "Unknown"}</div>
						<div class="product-info">
							${
								p.productData?.price
									? `<span class="info-item price">${formatPrice(
											p.productData.price,
											p.productData.currency
									  )}</span>`
									: ""
							}
							${
								p.productData?.rating
									? `<span class="info-item rating">⭐ ${p.productData.rating.toFixed(
											1
									  )}/5</span>`
									: ""
							}
							${
								p.productData?.reviewCount
									? `<span class="info-item">(${formatReviewCount(
											p.productData.reviewCount
									  )} reviews)</span>`
									: ""
							}
							${
								p.valueScore !== null
									? `<span class="value-score ${valueScoreCategory}">Value: ${p.valueScore.toFixed(
											1
									  )}/10</span>`
									: ""
							}
						</div>
						${p.priceAlert ? `<div class="price-alert ${p.priceAlert.type}">${p.priceAlert.message}</div>` : ""}
					</div>
					<div class="product-summary">${p.extractedSummary.replace(/\n/g, "<br>")}</div>
				</div>
				`;
				})
				.join("")}
		</div>
		
		<div class="comparison-section">
			<h2>📊 Detailed Comparison</h2>
			<div class="comparison-content">${comparisonText.replace(/\n/g, "<br>")}</div>
		</div>
	</div>
</body>
</html>`;
}

/* Helper Functions */
function formatPrice(price, currency = "USD") {
	// Use Intl.NumberFormat for proper currency formatting with thousands separators
	// This handles different currencies appropriately (e.g., JPY has no decimals)
	const formatter = new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: currency,
		minimumFractionDigits: currency === "JPY" ? 0 : 2,
		maximumFractionDigits: currency === "JPY" ? 0 : 2,
	});

	return formatter.format(price);
}

function formatReviewCount(count) {
	if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
	if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
	return count.toString();
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

// Shared flag to track if user has manually scrolled
let userHasScrolled = false;
let scrollCleanupTimer = null;

function scrollToId(id, delay = 100) {
	// If user has scrolled manually, don't initiate any automatic scrolling
	if (userHasScrolled) {
		return;
	}

	let timeoutId;
	let isScrolling = false;

	// Clean up function to remove all event listeners
	const cleanup = () => {
		window.removeEventListener("wheel", interruptScroll, { passive: true });
		window.removeEventListener("touchstart", interruptScroll, { passive: true });
		window.removeEventListener("keydown", interruptScroll);
		isScrolling = false;
	};

	// Interrupt scroll function
	const interruptScroll = (e) => {
		// Check if it's a user-initiated scroll action
		if (e.type === "keydown") {
			// Only interrupt on navigation keys
			const scrollKeys = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "];
			if (!scrollKeys.includes(e.key)) return;
		}

		// User is scrolling, set the shared flag to stop ALL automatic scrolling
		userHasScrolled = true;
		clearTimeout(timeoutId);
		cleanup();
	};

	// Add event listeners for user scroll actions
	window.addEventListener("wheel", interruptScroll, { passive: true });
	window.addEventListener("touchstart", interruptScroll, { passive: true });
	window.addEventListener("keydown", interruptScroll);

	isScrolling = true;

	timeoutId = setTimeout(() => {
		const element = document.getElementById(id);
		if (element && isScrolling && !userHasScrolled) {
			element.scrollIntoView({ behavior: "smooth", block: "start" });

			// Clean up listeners after scroll animation completes (smooth scroll typically takes ~500-1000ms)
			setTimeout(cleanup, 1000);
		} else {
			cleanup();
		}
	}, delay);
}

// Reset the scroll interruption flag when starting a new task
function resetScrollInterruption() {
	userHasScrolled = false;
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
