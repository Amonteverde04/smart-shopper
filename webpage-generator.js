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
				
				// Final update with complete HTML
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
							updatePageContent(data.fallbackWebpageHTML, data.fallbackWebpageHTML.length);
						}, 2000);
					}
				}
			} catch (e) {
				console.error('Failed to load fallback:', e);
			}
		}
	}
})();

function updatePageContent(html, charCount) {
	try {
		// If we have complete valid HTML, replace the entire page
		if (html.toLowerCase().indexOf('</html>') >= 0 && html.length > 1000) {
			document.open();
			document.write(html);
			document.close();
		} else if (html.toLowerCase().indexOf('<html') >= 0 || html.toLowerCase().indexOf('<!doctype') >= 0) {
			// Partial HTML - show preview with overlay
			const overlayStyle = '<style>.streaming-overlay{position:fixed;bottom:20px;right:20px;background:rgba(102,126,234,0.95);color:white;padding:15px 20px;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,0.3);font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;font-size:14px;z-index:10000;font-weight:600}.streaming-indicator{display:inline-block;width:8px;height:8px;background:white;border-radius:50%;margin-right:8px;animation:pulse 1.5s ease-in-out infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}</style>';
			const overlayDiv = '<div class="streaming-overlay"><span class="streaming-indicator"></span>Generating... ' + charCount + ' characters</div>';
			const previewHTML = html + overlayStyle + overlayDiv;
			document.open();
			document.write(previewHTML);
			document.close();
		}
	} catch (e) {
		console.error('Error updating page:', e);
	}
}

