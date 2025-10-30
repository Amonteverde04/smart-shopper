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
			const { pageText, productData } = await chrome.tabs.sendMessage(Number(tab.id), {
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

			// Calculate value score and track price
			const valueScore = calculateValueScore(productData);
			const priceAlert = await trackPrice(productData);
			
			productSummaries.push({ 
				id: tab.id, 
				title: tab.title, 
				extractedSummary: summary,
				productData: productData,
				valueScore: valueScore,
				priceAlert: priceAlert
			});
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
			(p, i) => {
				const valueScoreBadge = p.valueScore !== null 
					? `<div class="value-score-badge score-${getScoreCategory(p.valueScore)}">
							<span class="value-score-label">Value Score:</span>
							<span class="value-score-value">${p.valueScore.toFixed(1)}/10</span>
						</div>`
					: '';
				
				const priceInfo = p.productData && p.productData.price
					? `<div class="price-info">
							<span class="price-value">${formatPrice(p.productData.price, p.productData.currency)}</span>
							${p.priceAlert ? `<span class="price-alert ${p.priceAlert.type}">${p.priceAlert.message}</span>` : ''}
						</div>`
					: '';
				
				const ratingInfo = p.productData && p.productData.rating
					? `<div class="rating-info">
							⭐ ${p.productData.rating.toFixed(1)}${p.productData.reviewCount ? ` (${formatReviewCount(p.productData.reviewCount)} reviews)` : ''}
						</div>`
					: '';
				
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
							.filter(line => line.trim())
							.map(
								(line) => `<li class="summary-item">${line.replace(/^\*\s*/, "")}</li>`
							)
							.join("")}
					</ul>
				</div>
			</div>`;
			}
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

function displayComparison(result, productSummaries) {
	const comparisonHTML = marked.parse(result);
	const exportButtons = `
		<div class="export-buttons">
			<button id="export-text-btn" class="export-btn">📋 Copy as Text</button>
			<button id="export-json-btn" class="export-btn">💾 Export JSON</button>
			<button id="share-comparison-btn" class="export-btn">🔗 Share</button>
		</div>
	`;
	
	comparisonContent.innerHTML = comparisonHTML + exportButtons;
	comparisonContainer.style.display = "block";
	
	// Add event listeners for export buttons
	setupExportButtons(result, productSummaries);
	scrollToId(comparisonContainer.id);
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
	if (score >= 8) return 'excellent';
	if (score >= 6) return 'good';
	if (score >= 4) return 'fair';
	return 'poor';
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
		const alert = { type: '', message: '' };
		
		if (history.lastPrice && history.lastPrice > currentPrice) {
			const priceDrop = ((history.lastPrice - currentPrice) / history.lastPrice) * 100;
			
			if (priceDrop >= priceDropThreshold * 100) {
				alert.type = 'drop';
				alert.message = `💰 Price dropped ${priceDrop.toFixed(1)}%!`;
			}
		} else if (history.lastPrice && history.lastPrice < currentPrice) {
			const priceIncrease = ((currentPrice - history.lastPrice) / history.lastPrice) * 100;
			if (priceIncrease >= priceDropThreshold * 100) {
				alert.type = 'increase';
				alert.message = `📈 Price increased ${priceIncrease.toFixed(1)}%`;
			}
		}
		
		// Update history
		history.prices.push({
			price: currentPrice,
			currency: productData.currency,
			timestamp: Date.now()
		});
		
		// Keep only last 30 days of history
		const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
		history.prices = history.prices.filter(p => p.timestamp > thirtyDaysAgo);
		
		history.lastPrice = currentPrice;
		history.lastUpdate = Date.now();
		
		await chrome.storage.local.set({ [storageKey]: history });
		
		return alert.type ? alert : null;
	} catch (error) {
		console.error('Price tracking error:', error);
		return null;
	}
}

/* Feature 3: Export & Share Comparisons */
function setupExportButtons(comparisonText, productSummaries) {
	const exportTextBtn = document.getElementById("export-text-btn");
	const exportJsonBtn = document.getElementById("export-json-btn");
	const shareBtn = document.getElementById("share-comparison-btn");
	
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
}

async function exportAsText(comparisonText, productSummaries) {
	if (!productSummaries || !Array.isArray(productSummaries)) {
		console.error("Invalid productSummaries:", productSummaries);
		showExportNotification("❌ No data to export");
		return;
	}
	
	const text = `Smart Shopper Comparison Report\n` +
		`Generated: ${new Date().toLocaleString()}\n\n` +
		`=== PRODUCT SUMMARIES ===\n\n` +
		productSummaries.map((p, i) => {
			let text = `Product ${i + 1}: ${p.title || 'Unknown'}\n`;
			if (p.productData) {
				if (p.productData.price) {
					text += `Price: ${formatPrice(p.productData.price, p.productData.currency)}\n`;
				}
				if (p.productData.rating) {
					text += `Rating: ${p.productData.rating.toFixed(1)}/5`;
					if (p.productData.reviewCount) {
						text += ` (${p.productData.reviewCount} reviews)`;
					}
					text += '\n';
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
		}).join('---\n\n') +
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
		products: productSummaries.map(p => ({
			title: p.title,
			summary: p.extractedSummary,
			productData: p.productData,
			valueScore: p.valueScore,
			priceAlert: p.priceAlert
		}))
	};
	
	const jsonStr = JSON.stringify(data, null, 2);
	const blob = new Blob([jsonStr], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
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
	
	const summary = productSummaries.map((p, i) => {
		let text = `${i + 1}. ${p.title || 'Product'}`;
		if (p.valueScore !== null) {
			text += ` (Value: ${p.valueScore.toFixed(1)}/10)`;
		}
		return text;
	}).join('\n');
	
	const shareText = `🏪 Smart Shopper Comparison\n\n${summary}\n\nSee full comparison in Smart Shopper extension.`;
	
	if (navigator.share) {
		try {
			await navigator.share({
				title: 'Smart Shopper Comparison',
				text: shareText
			});
			showExportNotification("✅ Shared successfully!");
		} catch (error) {
			// User cancelled or share failed
			console.log('Share cancelled:', error);
		}
	} else {
		// Fallback: copy to clipboard
		await navigator.clipboard.writeText(shareText);
		showExportNotification("✅ Comparison link copied to clipboard!");
	}
}

function showExportNotification(message) {
	const notification = document.createElement('div');
	notification.className = 'export-notification';
	notification.textContent = message;
	document.body.appendChild(notification);
	
	setTimeout(() => {
		notification.classList.add('show');
	}, 10);
	
	setTimeout(() => {
		notification.classList.remove('show');
		setTimeout(() => notification.remove(), 300);
	}, 2000);
}

/* Helper Functions */
function formatPrice(price, currency = 'USD') {
	const symbol = {
		'USD': '$',
		'EUR': '€',
		'GBP': '£',
		'JPY': '¥',
		'INR': '₹'
	}[currency] || '$';
	
	return `${symbol}${price.toFixed(2)}`;
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
