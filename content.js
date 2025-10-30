// Smart content extraction for product pages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.action === "extractProduct") {
		const pageText = extractSmartContent();
		const productData = extractProductData();
		sendResponse({ pageText, productData });
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
 * Extract structured product data for price tracking and value scoring
 */
function extractProductData() {
	const data = {
		url: window.location.href,
		title: extractTitle(),
		price: extractPrice(),
		rating: extractRating(),
		reviewCount: extractReviewCount(),
		currency: extractCurrency(),
		timestamp: Date.now()
	};
	return data;
}

/**
 * Extract product title
 */
function extractTitle() {
	// Try JSON-LD first
	const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
	for (const script of jsonLdScripts) {
		try {
			const data = JSON.parse(script.textContent);
			const product = Array.isArray(data) ? data.find(d => d['@type'] === 'Product') : data;
			if (product && product['@type'] === 'Product' && product.name) {
				return product.name;
			}
		} catch (e) {
			// Ignore
		}
	}

	// Try meta tags
	const ogTitle = document.querySelector('meta[property="og:title"]');
	if (ogTitle) return ogTitle.getAttribute('content');

	// Try common title selectors
	const titleSelectors = [
		'h1[class*="title"]', 'h1[class*="product"]', '#productTitle',
		'.product-title', '.pdp-product-name', 'h1'
	];
	for (const selector of titleSelectors) {
		const el = document.querySelector(selector);
		if (el && el.innerText.trim()) {
			return el.innerText.trim();
		}
	}

	return document.title;
}

/**
 * Extract product price
 */
function extractPrice() {
	// Try JSON-LD first
	const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
	for (const script of jsonLdScripts) {
		try {
			const data = JSON.parse(script.textContent);
			const product = Array.isArray(data) ? data.find(d => d['@type'] === 'Product') : data;
			if (product && product['@type'] === 'Product' && product.offers) {
				const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
				if (offers && offers.price) {
					return parseFloat(offers.price);
				}
			}
		} catch (e) {
			// Ignore
		}
	}

	// Try common price selectors
	const priceSelectors = [
		'[data-testid*="price"]', '[data-cy*="price"]',
		'.price', '.cost', '.amount', '[class*="price"]',
		'.a-price-whole'
	];
	
	for (const selector of priceSelectors) {
		const elements = document.querySelectorAll(selector);
		for (const el of elements) {
			const text = el.innerText || el.textContent || '';
			const price = parsePriceFromText(text);
			if (price) return price;
		}
	}

	// Search in body text
	const bodyText = document.body.innerText;
	const price = parsePriceFromText(bodyText);
	return price || null;
}

/**
 * Parse price from text string
 */
function parsePriceFromText(text) {
	// Match common price patterns: $123.45, €123.45, £123, 123.45, etc.
	const patterns = [
		/\$\s*(\d{1,3}(?:[,\.]\d{3})*(?:\.\d{2})?)/,  // $123.45 or $1,234.56
		/(\d{1,3}(?:[,\.]\d{3})*(?:\.\d{2})?)\s*[€£¥₹]/,  // 123.45€
		/(?:price|cost|pay)[:\s]*\$?\s*(\d{1,3}(?:[,\.]\d{3})*(?:\.\d{2})?)/i,
	];

	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match) {
			const priceStr = match[1].replace(/,/g, '');
			const price = parseFloat(priceStr);
			if (!isNaN(price) && price > 0 && price < 10000000) {
				return price;
			}
		}
	}

	return null;
}

/**
 * Extract currency
 */
function extractCurrency() {
	const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
	for (const script of jsonLdScripts) {
		try {
			const data = JSON.parse(script.textContent);
			const product = Array.isArray(data) ? data.find(d => d['@type'] === 'Product') : data;
			if (product && product['@type'] === 'Product' && product.offers) {
				const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
				if (offers && offers.priceCurrency) {
					return offers.priceCurrency;
				}
			}
		} catch (e) {
			// Ignore
		}
	}

	// Try to detect from page text
	const bodyText = document.body.innerText;
	if (/\$/.test(bodyText)) return 'USD';
	if (/€/.test(bodyText)) return 'EUR';
	if (/£/.test(bodyText)) return 'GBP';
	if (/¥/.test(bodyText)) return 'JPY';
	if (/₹/.test(bodyText)) return 'INR';

	return 'USD'; // Default
}

/**
 * Extract product rating
 */
function extractRating() {
	// Try JSON-LD
	const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
	for (const script of jsonLdScripts) {
		try {
			const data = JSON.parse(script.textContent);
			const product = Array.isArray(data) ? data.find(d => d['@type'] === 'Product') : data;
			if (product && product['@type'] === 'Product' && product.aggregateRating) {
				const rating = product.aggregateRating.ratingValue;
				if (rating) return parseFloat(rating);
			}
		} catch (e) {
			// Ignore
		}
	}

	// Try common rating selectors
	const ratingSelectors = [
		'[data-testid*="rating"]', '[class*="rating"]',
		'.star-rating', '[aria-label*="rating"]'
	];
	
	for (const selector of ratingSelectors) {
		const el = document.querySelector(selector);
		if (el) {
			const text = el.innerText || el.getAttribute('aria-label') || '';
			const rating = parseRatingFromText(text);
			if (rating) return rating;
		}
	}

	return null;
}

/**
 * Extract review count
 */
function extractReviewCount() {
	// Try JSON-LD
	const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
	for (const script of jsonLdScripts) {
		try {
			const data = JSON.parse(script.textContent);
			const product = Array.isArray(data) ? data.find(d => d['@type'] === 'Product') : data;
			if (product && product['@type'] === 'Product' && product.aggregateRating) {
				const count = product.aggregateRating.reviewCount;
				if (count) return parseInt(count);
			}
		} catch (e) {
			// Ignore
		}
	}

	// Try to find review count in text
	const bodyText = document.body.innerText;
	const reviewPatterns = [
		/(\d+)\s*(?:reviews?|ratings?)/i,
		/\((\d+)\s*reviews?\)/i
	];
	
	for (const pattern of reviewPatterns) {
		const match = bodyText.match(pattern);
		if (match) {
			const count = parseInt(match[1]);
			if (count > 0) return count;
		}
	}

	return null;
}

/**
 * Parse rating from text (e.g., "4.5 out of 5", "4.5 stars", "4.5/5")
 */
function parseRatingFromText(text) {
	const patterns = [
		/(\d+\.?\d*)\s*(?:out\s*of|\/)\s*5/i,
		/(\d+\.?\d*)\s*stars?/i,
		/rating[:\s]*(\d+\.?\d*)/i
	];

	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match) {
			const rating = parseFloat(match[1]);
			if (!isNaN(rating) && rating >= 0 && rating <= 5) {
				return rating;
			}
		}
	}

	return null;
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
