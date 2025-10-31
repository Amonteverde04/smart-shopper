// Get embedded data from URL hash
(async function() {
	try {
		// Get data from URL hash
		let embeddedData = null;
		
		// Try to get from URL hash (supports large data)
		const hashData = window.location.hash.substring(1);
		if (hashData) {
			try {
				embeddedData = JSON.parse(decodeURIComponent(hashData));
			} catch (e) {
				console.error('Failed to parse hash data:', e);
			}
		}
		
		if (!embeddedData) {
			throw new Error('No data received for webpage generation. Please try again.');
		}
		
		// Update status function
		function updateStatus(text, charCount) {
			const el = document.getElementById('char-count');
			const bar = document.getElementById('progress-bar');
			if (el) el.textContent = text;
			if (bar && charCount !== undefined) {
				const progress = Math.min(100, (charCount / 5000) * 100);
				bar.style.width = progress + '%';
			}
		}
		
		updateStatus('Creating AI model session...', 0);
		
		// Check LanguageModel availability
		const availability = await LanguageModel.availability();
		if (availability === "unavailable") {
			throw new Error("Language model is not available on this device");
		}
		
		const options = { initialPrompts: embeddedData.initialPrompts };
		
		// Add download progress monitoring if needed
		if (availability === "downloading" || availability === "downloadable") {
			options.monitor = (m) => {
				m.addEventListener("downloadprogress", (e) => {
					updateStatus('Downloading AI model... ' + Math.round(e.loaded * 100) + '%', 0);
				});
			};
		}
		
		updateStatus('Initializing AI model...', 0);
		
		// Create LanguageModel session
		const session = await LanguageModel.create(options);
		
		updateStatus('Generating webpage HTML...', 0);
		
		let fullHTML = '';
		let lastUpdateTime = 0;
		const UPDATE_INTERVAL = 200; // Update every 200ms
		
		// Try streaming if available
		try {
			if (session.promptStreaming) {
				const stream = session.promptStreaming(embeddedData.prompt);
				
				for await (const chunk of stream) {
					fullHTML += chunk;
					
					const now = Date.now();
					if (now - lastUpdateTime > UPDATE_INTERVAL) {
						updateStatus('Generating... ' + fullHTML.length + ' characters', fullHTML.length);
						
						// Update page content if we have valid HTML
						if (fullHTML.length > 500 && fullHTML.toLowerCase().indexOf('<html') >= 0) {
							updatePageContent(fullHTML, fullHTML.length);
						}
						
						lastUpdateTime = now;
					}
				}
				
				// Inject chatbot widget and update with complete HTML
				fullHTML = injectChatbotWidget(fullHTML, embeddedData.productSummaries);
				updatePageContent(fullHTML, fullHTML.length);
				updateStatus('Complete!', fullHTML.length);
				return;
			}
			
			// Fallback: Try ReadableStream
			const response = await session.prompt(embeddedData.prompt, { stream: true });
			
			if (response && typeof response.getReader === 'function') {
				const reader = response.getReader();
				const decoder = new TextDecoder();
				
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					
					const chunk = decoder.decode(value, { stream: true });
					fullHTML += chunk;
					
					const now = Date.now();
					if (now - lastUpdateTime > UPDATE_INTERVAL) {
						updateStatus('Generating... ' + fullHTML.length + ' characters', fullHTML.length);
						
						if (fullHTML.length > 500 && fullHTML.toLowerCase().indexOf('<html') >= 0) {
							updatePageContent(fullHTML, fullHTML.length);
						}
						
						lastUpdateTime = now;
					}
				}
				
				// Inject chatbot widget and update with complete HTML
				fullHTML = injectChatbotWidget(fullHTML, embeddedData.productSummaries);
				updatePageContent(fullHTML, fullHTML.length);
				updateStatus('Complete!', fullHTML.length);
				return;
			}
			
			// Final fallback: Regular prompt
			const result = await (response && typeof response.then === 'function' ? response : session.prompt(embeddedData.prompt));
			fullHTML = typeof result === 'string' ? result : String(result);
			
		} catch (streamError) {
			console.log('Streaming failed, using regular prompt:', streamError);
			const result = await session.prompt(embeddedData.prompt);
			fullHTML = typeof result === 'string' ? result : String(result);
		}
		
		// Clean up HTML
		fullHTML = fullHTML.trim();
		const codeBlockPattern1 = new RegExp('^\\`\\`\\`html\\s*', 'i');
		const codeBlockPattern2 = new RegExp('^\\`\\`\\`\\s*', 'i');
		const codeBlockPattern3 = new RegExp('\\s*\\`\\`\\`$', 'i');
		fullHTML = fullHTML.replace(codeBlockPattern1, '');
		fullHTML = fullHTML.replace(codeBlockPattern2, '');
		fullHTML = fullHTML.replace(codeBlockPattern3, '');
		fullHTML = fullHTML.trim();
		
		// Validate HTML
		if (fullHTML.toLowerCase().indexOf('<!doctype html') < 0 && 
			fullHTML.toLowerCase().indexOf('<html') < 0) {
			fullHTML = embeddedData.fallbackWebpageHTML;
		}
		
		// Inject chatbot widget into HTML before </body>
		fullHTML = injectChatbotWidget(fullHTML, embeddedData.productSummaries);
		
		// Update page with final HTML
		updatePageContent(fullHTML, fullHTML.length);
		updateStatus('Complete!', fullHTML.length);
		
	} catch (error) {
		console.error('Generation error:', error);
		const errorContainer = document.querySelector('.loading-container');
		if (errorContainer) {
			errorContainer.innerHTML = 
				'<div class="error">' +
				'<h3>❌ Error generating webpage</h3>' +
				'<p>' + error.message + '</p>' +
				'<p style="margin-top:10px;font-size:12px;opacity:0.8;">Using fallback template...</p>' +
				'</div>';
			
			// Try to get fallback from URL or use default
			try {
				const hashData = window.location.hash.substring(1);
				if (hashData) {
					const data = JSON.parse(decodeURIComponent(hashData));
					if (data.fallbackWebpageHTML) {
						setTimeout(() => {
							let fallbackHTML = data.fallbackWebpageHTML;
							// Inject chatbot widget into fallback HTML
							if (data.productSummaries) {
								fallbackHTML = injectChatbotWidget(fallbackHTML, data.productSummaries);
							}
							updatePageContent(fallbackHTML, fallbackHTML.length);
						}, 2000);
					}
				}
			} catch (e) {
				console.error('Failed to load fallback:', e);
			}
		}
	}
})();

function formatPrice(price, currency = "USD") {
	const formatter = new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: currency,
		minimumFractionDigits: currency === "JPY" ? 0 : 2,
		maximumFractionDigits: currency === "JPY" ? 0 : 2,
	});
	return formatter.format(price);
}

function formatReviewCount(count) {
	if (count >= 1000000) return (count / 1000000).toFixed(1) + "M";
	if (count >= 1000) return (count / 1000).toFixed(1) + "K";
	return count.toString();
}

function createChatbotWidgetCode(productSummaries) {
	const productInfo = productSummaries.map((p, i) => ({
		number: i + 1,
		title: p.title || `Product ${i + 1}`,
		summary: p.extractedSummary,
		price: p.productData?.price ? formatPrice(p.productData.price, p.productData.currency) : null,
		rating: p.productData?.rating ? p.productData.rating.toFixed(1) + "/5" : null,
		reviewCount: p.productData?.reviewCount ? formatReviewCount(p.productData.reviewCount) : null,
		valueScore: p.valueScore !== null ? p.valueScore.toFixed(1) : null,
		url: p.productData?.url || null
	}));

	// Store product info globally so it can be accessed by the chatbot initialization
	// This avoids CSP issues with inline scripts
	if (typeof window !== 'undefined') {
		window.chatbotProductInfo = productInfo;
	}

	// JSON string for embedding in data attribute
	const jsonString = JSON.stringify(productInfo);

	return `
	<style>
		.chatbot-container {
			position: fixed;
			bottom: 20px;
			right: 20px;
			z-index: 10000;
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		}
		.chatbot-button {
			width: 60px;
			height: 60px;
			border-radius: 50%;
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			border: none;
			cursor: pointer;
			box-shadow: 0 4px 12px rgba(0,0,0,0.3);
			display: flex;
			align-items: center;
			justify-content: center;
			color: white;
			font-size: 24px;
			transition: transform 0.3s ease, box-shadow 0.3s ease;
		}
		.chatbot-button:hover {
			transform: scale(1.1);
			box-shadow: 0 6px 20px rgba(0,0,0,0.4);
		}
		.chatbot-window {
			position: absolute;
			bottom: 80px;
			right: 0;
			width: 380px;
			height: 500px;
			background: white;
			border-radius: 20px;
			box-shadow: 0 8px 30px rgba(0,0,0,0.3);
			display: none;
			flex-direction: column;
			overflow: hidden;
		}
		.chatbot-window.open {
			display: flex;
		}
		.chatbot-header {
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			color: white;
			padding: 15px 20px;
			display: flex;
			justify-content: space-between;
			align-items: center;
		}
		.chatbot-header h3 {
			margin: 0;
			font-size: 18px;
			font-weight: 600;
		}
		.chatbot-close {
			background: rgba(255,255,255,0.3);
			border: none;
			color: white;
			width: 30px;
			height: 30px;
			border-radius: 50%;
			cursor: pointer;
			font-size: 18px;
			display: flex;
			align-items: center;
			justify-content: center;
		}
		.chatbot-messages {
			flex: 1;
			overflow-y: auto;
			padding: 20px;
			background: #f5f5f5;
		}
		.chatbot-message {
			margin-bottom: 15px;
			display: flex;
			align-items: flex-start;
		}
		.chatbot-message.user {
			justify-content: flex-end;
		}
		.chatbot-message-bubble {
			max-width: 75%;
			padding: 12px 16px;
			border-radius: 18px;
			word-wrap: break-word;
		}
		.chatbot-message.user .chatbot-message-bubble {
			background: #667eea;
			color: white;
			border-bottom-right-radius: 4px;
		}
		.chatbot-message.bot .chatbot-message-bubble {
			background: white;
			color: #333;
			border-bottom-left-radius: 4px;
			box-shadow: 0 2px 5px rgba(0,0,0,0.1);
		}
		.chatbot-message.bot .chatbot-message-bubble a {
			color: #667eea;
			text-decoration: none;
			font-weight: 600;
		}
		.chatbot-message.bot .chatbot-message-bubble a:hover {
			text-decoration: underline;
		}
		.chatbot-input-container {
			padding: 15px;
			background: white;
			border-top: 1px solid #e0e0e0;
			display: flex;
			gap: 10px;
			flex-shrink: 0;
			align-items: center;
		}
		.chatbot-input {
			flex: 1;
			padding: 10px 15px;
			border: 1px solid #e0e0e0;
			border-radius: 25px;
			font-size: 14px;
			outline: none;
		}
		.chatbot-input:focus {
			border-color: #667eea;
		}
		.chatbot-send {
			background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
			color: white;
			border: none;
			padding: 10px 20px;
			border-radius: 25px;
			cursor: pointer;
			font-size: 14px;
			font-weight: 600;
			flex-shrink: 0;
			white-space: nowrap;
		}
		.chatbot-send:hover {
			opacity: 0.9;
		}
		.chatbot-send:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
		.chatbot-typing {
			display: none;
			padding: 12px 16px;
			background: white;
			border-radius: 18px;
			max-width: 75px;
		}
		.chatbot-typing.show {
			display: block;
		}
		.chatbot-typing span {
			display: inline-block;
			width: 8px;
			height: 8px;
			background: #ccc;
			border-radius: 50%;
			margin-right: 4px;
			animation: typing 1.4s infinite;
		}
		.chatbot-typing span:nth-child(2) {
			animation-delay: 0.2s;
		}
		.chatbot-typing span:nth-child(3) {
			animation-delay: 0.4s;
		}
		@keyframes typing {
			0%, 60%, 100% { transform: translateY(0); }
			30% { transform: translateY(-10px); }
		}
		@media (max-width: 480px) {
			.chatbot-window {
				width: calc(100vw - 40px);
				right: -10px;
			}
		}
	</style>
	<div class="chatbot-container">
		<div class="chatbot-window" id="chatbot-window">
			<div class="chatbot-header">
				<h3>💬 Chat about Products</h3>
				<button class="chatbot-close" id="chatbot-close">×</button>
			</div>
			<div class="chatbot-messages" id="chatbot-messages">
				<div class="chatbot-message bot">
					<div class="chatbot-message-bubble">
						Hello! I can help you learn more about these products, compare them, or open product links. What would you like to know?
					</div>
				</div>
			</div>
			<div class="chatbot-input-container">
				<input type="text" class="chatbot-input" id="chatbot-input" placeholder="Ask me anything..." />
				<button class="chatbot-send" id="chatbot-send">Send</button>
			</div>
		</div>
		<button class="chatbot-button" id="chatbot-button">💬</button>
	</div>
	<div id="chatbot-product-data" style="display:none;" data-product-info="${encodeURIComponent(jsonString)}"></div>
	`;
}

function injectChatbotWidget(html, productSummaries) {
	if (!productSummaries || !Array.isArray(productSummaries) || productSummaries.length === 0) {
		return html;
	}

	// Find </body> tag and inject chatbot widget before it
	const bodyEndIndex = html.toLowerCase().lastIndexOf('</body>');
	if (bodyEndIndex === -1) {
		// No </body> tag, append before </html> or at the end
		const htmlEndIndex = html.toLowerCase().lastIndexOf('</html>');
		if (htmlEndIndex !== -1) {
			return html.substring(0, htmlEndIndex) + createChatbotWidgetCode(productSummaries) + html.substring(htmlEndIndex);
		}
		return html + createChatbotWidgetCode(productSummaries);
	}

	return html.substring(0, bodyEndIndex) + createChatbotWidgetCode(productSummaries) + html.substring(bodyEndIndex);
}

function updatePageContent(html, charCount) {
	try {
		// If we have complete valid HTML, replace the entire page
		if (html.toLowerCase().indexOf('</html>') >= 0 && html.length > 1000) {
			document.open();
			document.write(html);
			document.close();
			// Initialize chatbot after page is written
			setTimeout(() => initializeChatbot(), 100);
		} else if (html.toLowerCase().indexOf('<html') >= 0 || html.toLowerCase().indexOf('<!doctype') >= 0) {
			// Partial HTML - show preview with overlay
			const overlayStyle = '<style>.streaming-overlay{position:fixed;bottom:20px;right:20px;background:rgba(102,126,234,0.95);color:white;padding:15px 20px;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;font-size:14px;z-index:10000;font-weight:600}.streaming-indicator{display:inline-block;width:8px;height:8px;background:white;border-radius:50%;margin-right:8px;animation:pulse 1.5s ease-in-out infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}</style>';
			const overlayDiv = '<div class="streaming-overlay"><span class="streaming-indicator"></span>Generating... ' + charCount + ' characters</div>';
			const previewHTML = html + overlayStyle + overlayDiv;
			document.open();
			document.write(previewHTML);
			document.close();
			// Initialize chatbot if product data exists (check for the data element)
			if (html.indexOf('chatbot-product-data') >= 0) {
				setTimeout(() => initializeChatbot(), 100);
			}
		}
	} catch (e) {
		console.error('Error updating page:', e);
	}
}

function initializeChatbot() {
	try {
		// Get product info from data attribute
		const dataElement = document.getElementById('chatbot-product-data');
		if (!dataElement) {
			console.log('Chatbot: No product data found');
			return;
		}

		const encodedData = dataElement.getAttribute('data-product-info');
		if (!encodedData) {
			console.log('Chatbot: No product data in attribute');
			return;
		}

		const productInfo = JSON.parse(decodeURIComponent(encodedData));
		const button = document.getElementById('chatbot-button');
		const chatWindow = document.getElementById('chatbot-window');
		const closeBtn = document.getElementById('chatbot-close');
		const messagesContainer = document.getElementById('chatbot-messages');
		const input = document.getElementById('chatbot-input');
		const sendBtn = document.getElementById('chatbot-send');

		if (!button || !chatWindow || !messagesContainer || !input || !sendBtn) {
			console.log('Chatbot: Required elements not found', { button, chatWindow, messagesContainer, input, sendBtn });
			return;
		}

		let languageModelSession = null;
		let isInitializing = false;

		function initChatbot() {
			if (languageModelSession || isInitializing) return;
			isInitializing = true;

			const systemPrompt = `You are a helpful shopping assistant chatbot. You can answer questions about products, compare them, and help users make informed decisions.

PRODUCT INFORMATION:
${JSON.stringify(productInfo, null, 2)}

When users ask about specific products, refer to them by number (Product 1, Product 2, etc.) or by name.
If users want to see a product link, mention the product number and that you can open it for them.
Keep responses concise and helpful. Use the product information provided to answer questions accurately.`;

			LanguageModel.availability().then(availability => {
				if (availability === 'unavailable') {
					addMessage('bot', 'Sorry, AI features are not available on this device.');
					isInitializing = false;
					return;
				}

				const options = {
					initialPrompts: [{ role: 'system', content: systemPrompt }]
				};

				if (availability === 'downloading' || availability === 'downloadable') {
					options.monitor = (m) => {
						m.addEventListener('downloadprogress', (e) => {
							console.log('Download progress:', Math.round(e.loaded * 100) + '%');
						});
					};
				}

				LanguageModel.create(options).then(session => {
					languageModelSession = session;
					isInitializing = false;
				}).catch(err => {
					console.error('Failed to create language model:', err);
					addMessage('bot', 'Sorry, I couldn\'t initialize. Please try again.');
					isInitializing = false;
				});
			});
		}

		function addMessage(role, text) {
			const messageDiv = document.createElement('div');
			messageDiv.className = 'chatbot-message ' + role;
			const bubble = document.createElement('div');
			bubble.className = 'chatbot-message-bubble';
			
			// Parse links and product references
			let processedText = text;
			// Convert product URLs to clickable links
			productInfo.forEach((product, index) => {
				if (product.url) {
					// Escape special regex characters in product title
					const escapedTitle = product.title.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
					const regex = new RegExp('(Product ' + (index + 1) + '|' + escapedTitle + ')', 'gi');
					processedText = processedText.replace(regex, (match) => {
						return '<a href="' + product.url + '" target="_blank" data-product-index="' + index + '">' + match + '</a>';
					});
				}
			});
			
			bubble.innerHTML = processedText;
			messageDiv.appendChild(bubble);
			messagesContainer.appendChild(messageDiv);
			messagesContainer.scrollTop = messagesContainer.scrollHeight;

			// Add click handlers for product links
			bubble.querySelectorAll('a[data-product-index]').forEach(link => {
				link.addEventListener('click', (e) => {
					e.preventDefault();
					const index = parseInt(link.getAttribute('data-product-index'));
					const product = productInfo[index];
					if (product && product.url) {
						// Try to use chrome extension API if available, otherwise use window.open
						if (typeof chrome !== 'undefined' && chrome.tabs) {
							chrome.tabs.create({ url: product.url, active: true });
						} else {
							window.open(product.url, '_blank');
						}
					}
				});
			});
		}

		function showTyping() {
			const typingDiv = document.createElement('div');
			typingDiv.className = 'chatbot-message bot';
			typingDiv.id = 'typing-indicator';
			typingDiv.innerHTML = '<div class="chatbot-message-bubble chatbot-typing show"><span></span><span></span><span></span></div>';
			messagesContainer.appendChild(typingDiv);
			messagesContainer.scrollTop = messagesContainer.scrollHeight;
		}

		function hideTyping() {
			const typing = document.getElementById('typing-indicator');
			if (typing) typing.remove();
		}

		async function sendMessage() {
			const message = input.value.trim();
			if (!message) return;

			addMessage('user', message);
			input.value = '';
			sendBtn.disabled = true;

			if (!languageModelSession && !isInitializing) {
				initChatbot();
				setTimeout(() => sendMessage(), 500);
				return;
			}

			if (!languageModelSession) {
				showTyping();
				// Wait for initialization
				const checkInterval = setInterval(() => {
					if (languageModelSession) {
						clearInterval(checkInterval);
						hideTyping();
						processMessage(message);
					}
				}, 100);
				setTimeout(() => {
					clearInterval(checkInterval);
					if (!languageModelSession) {
						hideTyping();
						addMessage('bot', 'Still initializing... Please try again in a moment.');
						sendBtn.disabled = false;
					}
				}, 5000);
				return;
			}

			processMessage(message);
		}

		async function processMessage(message) {
			showTyping();

			try {
				const response = await languageModelSession.prompt(message);
				hideTyping();
				addMessage('bot', response);
			} catch (error) {
				console.error('Chatbot error:', error);
				hideTyping();
				addMessage('bot', 'Sorry, I encountered an error. Please try again.');
			}

			sendBtn.disabled = false;
			input.focus();
		}

		button.addEventListener('click', () => {
			chatWindow.classList.toggle('open');
			if (chatWindow.classList.contains('open')) {
				input.focus();
				initChatbot();
			}
		});

		closeBtn.addEventListener('click', () => {
			chatWindow.classList.remove('open');
		});

		sendBtn.addEventListener('click', sendMessage);

		input.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				sendMessage();
			}
		});
	} catch (error) {
		console.error('Error initializing chatbot:', error);
	}
}

