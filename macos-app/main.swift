import Cocoa
import WebKit
import UniformTypeIdentifiers

// ── Native Export Handler ────────────────────────────────────────────────────
// JS calls: window.webkit.messageHandlers.nativeExport.postMessage({filename, content})
// Swift presents NSSavePanel to save file to disk.
class NativeExportHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let filename = body["filename"] as? String,
              let content = body["content"] as? String else { return }

        DispatchQueue.main.async {
            let panel = NSSavePanel()
            panel.nameFieldStringValue = filename
            panel.allowedContentTypes = [.json]
            panel.canCreateDirectories = true
            if panel.runModal() == .OK, let url = panel.url {
                do {
                    try content.write(to: url, atomically: true, encoding: .utf8)
                } catch {
                    let alert = NSAlert()
                    alert.messageText = "Erro ao salvar: \(error.localizedDescription)"
                    alert.runModal()
                }
            }
        }
    }
}

// ── Native Email Handler ─────────────────────────────────────────────────────
// JS calls: window.webkit.messageHandlers.nativeEmail.postMessage({to, subject, body})
// Swift opens Mail.app compose window with HTML content.
class NativeEmailHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let to = body["to"] as? String,
              let subject = body["subject"] as? String,
              let htmlBody = body["body"] as? String else { return }

        DispatchQueue.main.async {
            let service = NSSharingService(named: .composeEmail)
            service?.recipients = [to]
            service?.subject = subject

            // Create attributed string from HTML for rich content
            if let data = htmlBody.data(using: .utf8),
               let attrStr = try? NSAttributedString(data: data,
                   options: [.documentType: NSAttributedString.DocumentType.html,
                             .characterEncoding: String.Encoding.utf8.rawValue],
                   documentAttributes: nil) {
                service?.perform(withItems: [attrStr])
            } else {
                service?.perform(withItems: [htmlBody])
            }
        }
    }
}

// ── Native Fetch Bridge ─────────────────────────────────────────────────────
// JS calls: window.webkit.messageHandlers.nativeFetch.postMessage({id, url})
// Swift fetches via URLSession (NO CORS), returns result to JS callback.
class NativeFetchHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let callbackId = body["id"] as? String,
              let urlStr = body["url"] as? String,
              let url = URL(string: urlStr) else { return }

        let webView = message.webView!

        var request = URLRequest(url: url, timeoutInterval: 20)
        request.setValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", forHTTPHeaderField: "User-Agent")

        URLSession.shared.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                if let error = error {
                    let escaped = error.localizedDescription
                        .replacingOccurrences(of: "\\", with: "\\\\")
                        .replacingOccurrences(of: "'", with: "\\'")
                    webView.evaluateJavaScript(
                        "window.__nativeFetchCb('\(callbackId)', null, '\(escaped)')"
                    )
                    return
                }
                guard let data = data else {
                    webView.evaluateJavaScript(
                        "window.__nativeFetchCb('\(callbackId)', null, 'No data')"
                    )
                    return
                }
                let base64 = data.base64EncodedString()
                webView.evaluateJavaScript(
                    "window.__nativeFetchCb('\(callbackId)', '\(base64)', null)"
                )
            }
        }.resume()
    }
}

class NavigationDelegate: NSObject, WKNavigationDelegate {
    let appBaseURL: URL

    init(appBaseURL: URL) {
        self.appBaseURL = appBaseURL
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        if url.isFileURL || url.scheme == "about" {
            decisionHandler(.allow)
            return
        }

        if navigationAction.navigationType == .other {
            decisionHandler(.allow)
            return
        }

        if url.scheme == "http" || url.scheme == "https" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }
}

// Handle target="_blank", alert(), confirm(), prompt()
class UIDelegate: NSObject, WKUIDelegate {
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url,
           (url.scheme == "http" || url.scheme == "https") {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancelar")
        let response = alert.runModal()
        completionHandler(response == .alertFirstButtonReturn)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 300, height: 24))
        input.stringValue = defaultText ?? ""
        alert.accessoryView = input
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancelar")
        let response = alert.runModal()
        completionHandler(response == .alertFirstButtonReturn ? input.stringValue : nil)
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var navDelegate: NavigationDelegate!
    var uiDelegate: UIDelegate!

    func applicationDidFinishLaunching(_ notification: Notification) {
        setupMenuBar()

        // Configure WKWebView with native fetch bridge
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        // Register native fetch message handler
        let fetchHandler = NativeFetchHandler()
        config.userContentController.add(fetchHandler, name: "nativeFetch")

        // Register native export message handler (file save via NSSavePanel)
        let exportHandler = NativeExportHandler()
        config.userContentController.add(exportHandler, name: "nativeExport")

        // Register native email message handler (compose via Mail.app)
        let emailHandler = NativeEmailHandler()
        config.userContentController.add(emailHandler, name: "nativeEmail")

        // Inject JS bridge before page load
        let bridgeScript = WKUserScript(source: """
            window.__nativeFetchPending = {};
            window.__nativeFetchCb = function(id, base64, error) {
                const cb = window.__nativeFetchPending[id];
                if (!cb) return;
                delete window.__nativeFetchPending[id];
                if (error) { cb.reject(new Error(error)); }
                else {
                    try {
                        const bin = atob(base64);
                        const bytes = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                        const text = new TextDecoder('utf-8').decode(bytes);
                        cb.resolve(text);
                    } catch(e) { cb.reject(e); }
                }
            };
            window.nativeFetch = function(url) {
                return new Promise(function(resolve, reject) {
                    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
                    window.__nativeFetchPending[id] = { resolve: resolve, reject: reject };
                    window.webkit.messageHandlers.nativeFetch.postMessage({ id: id, url: url });
                });
            };
            window.__hasNativeFetch = true;
            window.__hasNativeExport = true;
            window.nativeExport = function(filename, content) {
                window.webkit.messageHandlers.nativeExport.postMessage({ filename: filename, content: content });
            };
            window.__hasNativeEmail = true;
            window.nativeEmail = function(to, subject, body) {
                return new Promise(function(resolve) {
                    window.webkit.messageHandlers.nativeEmail.postMessage({ to: to, subject: subject, body: body });
                    resolve();
                });
            };
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        config.userContentController.addUserScript(bridgeScript)

        // Window size
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
        let width: CGFloat = min(1200, screenFrame.width * 0.85)
        let height: CGFloat = min(850, screenFrame.height * 0.9)
        let x = screenFrame.origin.x + (screenFrame.width - width) / 2
        let y = screenFrame.origin.y + (screenFrame.height - height) / 2

        window = NSWindow(
            contentRect: NSRect(x: x, y: y, width: width, height: height),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Ronda"
        window.minSize = NSSize(width: 600, height: 400)
        window.isReleasedWhenClosed = false
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden

        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]

        // Load index.html
        let bundle = Bundle.main
        var appBase: URL
        if let htmlURL = bundle.url(forResource: "index", withExtension: "html", subdirectory: "web") {
            appBase = htmlURL.deletingLastPathComponent()
            webView.loadFileURL(htmlURL, allowingReadAccessTo: appBase)
        } else {
            let binDir = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
            let webDir = binDir.deletingLastPathComponent().appendingPathComponent("Resources/web")
            appBase = webDir
            let htmlURL = webDir.appendingPathComponent("index.html")
            webView.loadFileURL(htmlURL, allowingReadAccessTo: webDir)
        }

        navDelegate = NavigationDelegate(appBaseURL: appBase)
        uiDelegate = UIDelegate()
        webView.navigationDelegate = navDelegate
        webView.uiDelegate = uiDelegate

        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    private func setupMenuBar() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Sobre Ronda", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Ocultar Ronda", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "Ocultar Outros", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Mostrar Todos", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Encerrar Ronda", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "Editar")
        editMenu.addItem(withTitle: "Desfazer", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = editMenu.addItem(withTitle: "Refazer", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Recortar", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copiar", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Colar", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Selecionar Tudo", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        let viewMenuItem = NSMenuItem()
        let viewMenu = NSMenu(title: "Visualização")
        viewMenu.addItem(withTitle: "Aumentar Zoom", action: #selector(webViewZoomIn), keyEquivalent: "+")
        viewMenu.addItem(withTitle: "Diminuir Zoom", action: #selector(webViewZoomOut), keyEquivalent: "-")
        viewMenu.addItem(withTitle: "Tamanho Real", action: #selector(webViewZoomReset), keyEquivalent: "0")
        viewMenu.addItem(NSMenuItem.separator())
        viewMenu.addItem(withTitle: "Recarregar", action: #selector(webViewReload), keyEquivalent: "r")
        viewMenuItem.submenu = viewMenu
        mainMenu.addItem(viewMenuItem)

        let windowMenuItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Janela")
        windowMenu.addItem(withTitle: "Minimizar", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Fechar", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenuItem.submenu = windowMenu
        mainMenu.addItem(windowMenuItem)

        NSApp.mainMenu = mainMenu
        NSApp.windowsMenu = windowMenu
    }

    @objc func webViewZoomIn() { webView.pageZoom *= 1.1 }
    @objc func webViewZoomOut() { webView.pageZoom /= 1.1 }
    @objc func webViewZoomReset() { webView.pageZoom = 1.0 }
    @objc func webViewReload() { webView.reload() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
