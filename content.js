// Smart content extraction for product pages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.action === "extractProduct") {
		const pageText = extractSmartContent();
		sendResponse({ pageText });
		return true;
	}
});

/**
 * Intelligently extracts and filters page content for LLM processing
 * Uses multiple strategies to prioritize relevant product information
 */
function extractSmartContent() {
	// Get configuration (can be customized via chrome.storage or passed as parameter)
	const config = getContentExtractionConfig();

	// Extract content using multiple strategies
	const contentSections = [
		...extractProductSpecificContent(),
		...extractStructuredContent(),
		...extractGeneralContent()
	];

	// Score and prioritize content
	const scoredContent = scoreContentRelevance(contentSections, config);
	
	// Filter and combine within limits
	return combineOptimalContent(scoredContent, config);
}

/**
 * Extract content using product-specific selectors for major e-commerce sites
 */
function extractProductSpecificContent() {
	const sections = [];
	
	// Common product page selectors across major e-commerce sites
	const productSelectors = {
		title: [
			'[data-testid*="title"]', '[data-cy*="title"]', '[data-qa*="title"]',
			'h1[class*="title"]', 'h1[class*="product"]', 'h1[id*="title"]',
			'.product-title', '.pdp-product-name', '.x-item-title-label',
			'#productTitle', '.product-name', '.item-title'
		],
		price: [
			'[data-testid*="price"]', '[data-cy*="price"]', '[class*="price"]',
			'[id*="price"]', '.price', '.cost', '.amount', '.currency',
			'.a-price-whole', '.notranslate', '[data-automation-id*="price"]'
		],
		description: [
			'[data-testid*="description"]', '[data-cy*="description"]',
			'.product-description', '.pdp-description', '.item-description',
			'#feature-bullets', '.product-details', '.product-info',
			'[class*="description"]', '[id*="description"]'
		],
		reviews: [
			'[data-testid*="review"]', '[data-cy*="review"]', '[class*="review"]',
			'.reviews-section', '.review-summary', '.rating-summary',
			'[id*="review"]', '.customer-reviews', '.review-content'
		],
		features: [
			'[data-testid*="feature"]', '[data-cy*="feature"]', '.features',
			'.product-features', '.key-features', '.highlights',
			'[class*="feature"]', '[id*="feature"]', '.specifications'
		],
		specs: [
			'[data-testid*="spec"]', '[data-cy*="spec"]', '.specifications',
			'.product-specs', '.tech-specs', '.product-attributes',
			'[class*="spec"]', '[id*="spec"]', '.details-section'
		]
	};

	// Extract content for each category
	Object.entries(productSelectors).forEach(([category, selectors]) => {
		const elements = findElementsBySelectors(selectors);
		elements.forEach(el => {
			const text = cleanText(el.innerText);
			if (text && text.length > getContentExtractionConfig().minTextLength) {
				sections.push({
					text,
					category,
					source: 'product-specific',
					element: el.tagName.toLowerCase(),
					confidence: 0.9
				});
			}
		});
	});

	return sections;
}

/**
 * Extract content from structured data and semantic HTML
 */
function extractStructuredContent() {
	const sections = [];

	// JSON-LD structured data
	const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
	jsonLdScripts.forEach(script => {
		try {
			const data = JSON.parse(script.textContent);
			const productInfo = extractProductFromJsonLd(data);
			if (productInfo) {
				sections.push({
					text: productInfo,
					category: 'structured-data',
					source: 'json-ld',
					confidence: 0.95
				});
			}
		} catch (e) {
			// Ignore malformed JSON-LD
		}
	});

	// Meta tags
	const metaTags = document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"], meta[name="description"]');
	metaTags.forEach(meta => {
		const content = meta.getAttribute('content');
		const property = meta.getAttribute('property') || meta.getAttribute('name');
		if (content && content.length > 20) {
			sections.push({
				text: content,
				category: 'meta',
				source: `meta-${property}`,
				confidence: 0.7
			});
		}
	});

	// Semantic HTML elements
	const semanticSelectors = [
		'article', 'section[class*="product"]', 'div[class*="product"]',
		'main', '[role="main"]', '.main-content'
	];
	
	semanticSelectors.forEach(selector => {
		const elements = document.querySelectorAll(selector);
		elements.forEach(el => {
			const text = cleanText(el.innerText);
			if (text && text.length > 50 && text.length < 2000) {
				sections.push({
					text,
					category: 'semantic',
					source: selector,
					element: el.tagName.toLowerCase(),
					confidence: 0.6
				});
			}
		});
	});

	return sections;
}

/**
 * Extract general content as fallback
 */
function extractGeneralContent() {
	const sections = [];
	const elements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, span');
	
	const config = getContentExtractionConfig();
	elements.forEach(el => {
		const text = cleanText(el.innerText);
		if (text && text.length > 20 && text.length < config.maxGeneralTextLength) {
			// Skip if already captured by more specific selectors
			if (!isAlreadyCaptured(text, sections)) {
				sections.push({
					text,
					category: 'general',
					source: 'fallback',
					element: el.tagName.toLowerCase(),
					confidence: 0.3
				});
			}
		}
	});

	return sections;
}

/**
 * Score content sections based on relevance to product information
 */
function scoreContentRelevance(sections, config) {
	const keywordPatterns = {
		price: /(\$|€|£|¥|₹|\d+\.\d{2}|price|cost|msrp|retail)/i,
		product: /(product|item|model|brand|manufacturer)/i,
		reviews: /(review|rating|star|customer|feedback|testimonial)/i,
		features: /(feature|benefit|includes|comes with|specifications)/i,
		shipping: /(shipping|delivery|free|fast|prime)/i,
		availability: /(stock|available|in stock|out of stock|limited)/i,
		warranty: /(warranty|guarantee|return|refund)/i
	};

	return sections.map(section => {
		let score = section.confidence;
		
		// Boost based on category
		if (config.priorityBoost[section.category]) {
			score *= config.priorityBoost[section.category];
		}

		// Boost based on keyword relevance
		Object.entries(keywordPatterns).forEach(([type, pattern]) => {
			if (pattern.test(section.text)) {
				const boost = config.keywordBoost[type] || 1.2;
				score *= boost;
			}
		});

		// Boost based on element type
		if (section.element && config.elementBoost[section.element]) {
			score *= config.elementBoost[section.element];
		}

		// Apply penalties for content quality issues
		const length = section.text.length;
		if (length < 30) score *= config.penalties.tooShort;
		if (length > 1000) score *= config.penalties.tooLong;

		// Penalize duplicate-looking content
		if (isDuplicateContent(section.text)) {
			score *= config.penalties.duplicate;
		}

		return { ...section, score };
	});
}

/**
 * Combine optimal content within size limits
 */
function combineOptimalContent(scoredSections, config) {
	// Sort by score (highest first)
	const sortedSections = scoredSections.sort((a, b) => b.score - a.score);
	
	// Deduplicate similar content
	const uniqueSections = deduplicateContent(sortedSections);
	
	// Select content within limits
	const selectedContent = [];
	let totalLength = 0;
	
	for (const section of uniqueSections) {
		const sectionText = truncateSection(section.text, config.maxSectionLength);
		
		if (totalLength + sectionText.length <= config.maxContentLength) {
			selectedContent.push({
				category: section.category,
				text: sectionText
			});
			totalLength += sectionText.length;
		} else {
			// Try to fit a truncated version
			const remainingSpace = config.maxContentLength - totalLength;
			if (remainingSpace > 100) {
				const truncated = sectionText.substring(0, remainingSpace - 3) + '...';
				selectedContent.push({
					category: section.category,
					text: truncated
				});
			}
			break;
		}
	}
	
	// Format final output
	return formatExtractedContent(selectedContent);
}

/**
 * Helper functions
 */
function findElementsBySelectors(selectors) {
	const elements = [];
	selectors.forEach(selector => {
		try {
			elements.push(...document.querySelectorAll(selector));
		} catch (e) {
			// Ignore invalid selectors
		}
	});
	return [...new Set(elements)]; // Remove duplicates
}

function cleanText(text) {
	if (!text) return '';
	return text
		.replace(/\s+/g, ' ')
		.replace(/[\r\n\t]/g, ' ')
		.trim();
}

function extractProductFromJsonLd(data) {
	if (Array.isArray(data)) {
		return data.map(extractProductFromJsonLd).filter(Boolean).join('\n');
	}
	
	if (data['@type'] === 'Product') {
		const info = [];
		if (data.name) info.push(`Product: ${data.name}`);
		if (data.description) info.push(`Description: ${data.description}`);
		if (data.offers && data.offers.price) info.push(`Price: ${data.offers.price} ${data.offers.priceCurrency || ''}`);
		if (data.brand) info.push(`Brand: ${typeof data.brand === 'string' ? data.brand : data.brand.name}`);
		if (data.aggregateRating) {
			info.push(`Rating: ${data.aggregateRating.ratingValue}/5 (${data.aggregateRating.reviewCount} reviews)`);
		}
		return info.join('\n');
	}
	
	return null;
}

function isAlreadyCaptured(text, existingSections) {
	const normalized = text.toLowerCase().trim();
	return existingSections.some(section => 
		section.text.toLowerCase().trim() === normalized ||
		(normalized.length > 50 && section.text.toLowerCase().includes(normalized.substring(0, 50)))
	);
}

function isDuplicateContent(text) {
	// Check for common duplicate patterns
	const duplicatePatterns = [
		/^(home|shop|cart|account|login|register|help|contact|about)$/i,
		/^(menu|navigation|breadcrumb|footer|header)$/i,
		/^(cookie|privacy|terms|policy)$/i,
		/^(\d+\s*(item|product)s?\s*in\s*(cart|bag))$/i
	];
	
	return duplicatePatterns.some(pattern => pattern.test(text.trim()));
}

function deduplicateContent(sections) {
	const seen = new Set();
	const unique = [];
	
	for (const section of sections) {
		const normalized = section.text.toLowerCase().replace(/\s+/g, ' ').trim();
		const key = normalized.substring(0, 100); // Use first 100 chars as key
		
		if (!seen.has(key)) {
			seen.add(key);
			unique.push(section);
		}
	}
	
	return unique;
}

function truncateSection(text, maxLength) {
	if (text.length <= maxLength) return text;
	
	const config = getContentExtractionConfig();
	const truncated = text.substring(0, maxLength);
	
	if (config.truncation.preferSentenceBoundary) {
		const lastSentence = truncated.lastIndexOf('.');
		if (lastSentence > maxLength * config.truncation.sentenceBoundaryThreshold) {
			return truncated.substring(0, lastSentence + 1);
		}
	}
	
	const lastSpace = truncated.lastIndexOf(' ');
	if (lastSpace > maxLength * config.truncation.wordBoundaryThreshold) {
		return truncated.substring(0, lastSpace) + '...';
	} else {
		return truncated + '...';
	}
}

function formatExtractedContent(sections) {
	if (!sections.length) return 'No relevant product content found.';
	
	// Group by category and format
	const grouped = {};
	sections.forEach(section => {
		if (!grouped[section.category]) {
			grouped[section.category] = [];
		}
		grouped[section.category].push(section.text);
	});
	
	const formatted = [];
	
	// Order categories by importance
	const categoryOrder = ['title', 'price', 'description', 'features', 'reviews', 'specs', 'structured-data', 'meta', 'semantic', 'general'];
	
	categoryOrder.forEach(category => {
		if (grouped[category]) {
			const categoryText = grouped[category].join('\n\n');
			if (categoryText.trim()) {
				formatted.push(categoryText);
			}
		}
	});
	
	return formatted.join('\n\n---\n\n');
}

/**
 * Get content extraction configuration
 * Can be extended to load from chrome.storage for user customization
 */
function getContentExtractionConfig() {
	return {
		// Content size limits
		maxContentLength: 8000,  // Total content limit for LLM context
		maxSectionLength: 1500,  // Max length per content section
		minTextLength: 10,       // Minimum text length to consider
		maxGeneralTextLength: 500, // Max length for general content
		
		// Priority multipliers for different content categories
		priorityBoost: {
			title: 3.0,           // Product titles are most important
			price: 2.5,           // Pricing information
			description: 2.0,     // Product descriptions
			reviews: 1.8,         // Customer reviews and ratings
			features: 1.5,        // Product features and specifications
			specs: 1.3,           // Technical specifications
			'structured-data': 2.2, // JSON-LD and structured data
			meta: 1.4,            // Meta tags
			semantic: 1.1,        // Semantic HTML content
			general: 1.0          // General fallback content
		},
		
		// Keyword relevance multipliers
		keywordBoost: {
			price: 1.2,
			product: 1.2,
			reviews: 1.2,
			features: 1.2,
			shipping: 1.1,
			availability: 1.1,
			warranty: 1.1
		},
		
		// Element type multipliers
		elementBoost: {
			h1: 1.3,
			h2: 1.2,
			h3: 1.1
		},
		
		// Content quality penalties
		penalties: {
			tooShort: 0.5,        // Text shorter than 30 chars
			tooLong: 0.7,         // Text longer than 1000 chars
			duplicate: 0.3        // Duplicate or boilerplate content
		},
		
		// Truncation preferences
		truncation: {
			preferSentenceBoundary: true,
			sentenceBoundaryThreshold: 0.7,  // Prefer sentence boundary if within 70% of limit
			wordBoundaryThreshold: 0.8       // Prefer word boundary if within 80% of limit
		}
	};
}
