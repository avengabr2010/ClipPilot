package com.clippilot.app

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.text.InputType
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * ClipPilot Android shell: a hardened WebView around the deployed web app.
 * Supports video import from the gallery (file chooser), MP4 downloads,
 * "share video to ClipPilot" and pull-to-refresh. All business logic stays server-side.
 */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private lateinit var refresh: SwipeRefreshLayout
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingShared: Uri? = null

    private val pickFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        fileCallback?.onReceiveValue(uris)
        fileCallback = null
    }

    private val prefs by lazy { getSharedPreferences("clippilot", Context.MODE_PRIVATE) }

    private fun baseUrl(): String? =
        BuildConfig.APP_URL.ifBlank { null } ?: prefs.getString("url", null)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        web = WebView(this)
        refresh = SwipeRefreshLayout(this).apply { addView(web) }
        setContentView(refresh)
        refresh.setOnRefreshListener { web.reload() }
        refresh.setOnChildScrollUpCallback { _, _ -> web.scrollY > 0 }

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = true
            userAgentString = "$userAgentString ClipPilotAndroid/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false)

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                val home = baseUrl()?.let { Uri.parse(it).host }
                // Same site (and Supabase auth redirects back to it) stay in-app; the rest opens in the browser.
                if (url.scheme == "https" && (url.host == home || url.host?.endsWith(".supabase.co") == true)) return false
                startActivity(Intent(Intent.ACTION_VIEW, url))
                return true
            }
            override fun onPageFinished(view: WebView, url: String) {
                refresh.isRefreshing = false
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val shared = pendingShared
                if (shared != null) {
                    pendingShared = null
                    callback.onReceiveValue(arrayOf(shared))
                    fileCallback = null
                    return true
                }
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "video/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("video/mp4", "video/quicktime", "video/webm"))
                }
                pickFile.launch(Intent.createChooser(intent, "Choisir une vidéo"))
                return true
            }
        }
        web.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
            val req = DownloadManager.Request(Uri.parse(url))
                .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
                .addRequestHeader("User-Agent", userAgent)
                .setTitle(name)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_MOVIES, "ClipPilot/$name")
            (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
            Toast.makeText(this, "Téléchargement de $name…", Toast.LENGTH_SHORT).show()
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        handleShare(intent)
        if (savedInstanceState != null) web.restoreState(savedInstanceState) else start()
    }

    private fun start(path: String = "/dashboard") {
        val url = baseUrl()
        if (url == null) askServerUrl() else web.loadUrl(url.trimEnd('/') + path)
    }

    private fun askServerUrl() {
        val input = EditText(this).apply {
            hint = "https://clippilot.exemple.com"
            inputType = InputType.TYPE_TEXT_VARIATION_URI
            setText(prefs.getString("url", "https://"))
        }
        AlertDialog.Builder(this)
            .setTitle("Adresse de ClipPilot")
            .setMessage("Entrez l'adresse HTTPS de votre application ClipPilot en ligne.")
            .setView(input)
            .setCancelable(false)
            .setPositiveButton("Continuer") { _, _ ->
                val value = input.text.toString().trim()
                if (value.startsWith("https://") && Uri.parse(value).host != null) {
                    prefs.edit().putString("url", value.trimEnd('/')).apply()
                    start()
                } else {
                    Toast.makeText(this, "Adresse invalide (https:// requis)", Toast.LENGTH_LONG).show()
                    askServerUrl()
                }
            }
            .show()
    }

    /** "Share video → ClipPilot": open the import page; the next file chooser receives the video. */
    private fun handleShare(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        @Suppress("DEPRECATION")
        val uri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM) ?: return
        pendingShared = uri
        if (::web.isInitialized && baseUrl() != null) start("/create")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShare(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }
}
