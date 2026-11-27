package com.clippilot.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import java.io.File
import java.text.DateFormat
import java.util.Date

private val Violet = Color(0xFF8B5CF6)
private val Bg = Color(0xFF07060C)
private val Card = Color(0xFF13111C)

class MainActivity : ComponentActivity() {
    private val vm: ClipViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handleShare(intent)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(primary = Violet, background = Bg, surface = Card, surfaceVariant = Card)) {
                Surface(Modifier.fillMaxSize(), color = Bg) { App(vm) }
            }
        }
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handleShare(intent) }

    private fun handleShare(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        @Suppress("DEPRECATION")
        (intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))?.let { vm.pick(it) }
    }
}

@Composable
private fun App(vm: ClipViewModel) {
    val ctx = LocalContext.current
    vm.error?.let { msg ->
        AlertDialog(onDismissRequest = { vm.error = null }, title = { Text("Oups") },
            text = { Text(msg) }, confirmButton = { TextButton(onClick = { vm.error = null }) { Text("OK") } })
    }
    if (vm.loading) {
        AlertDialog(onDismissRequest = {}, confirmButton = {}, title = { Text("Lecture de la vidéo…") },
            text = { LinearProgressIndicator(Modifier.fillMaxWidth()) })
    }
    val s = vm.screen
    BackHandler(enabled = s !is Screen.Home && s !is Screen.Processing) { vm.screen = Screen.Home }
    Box(Modifier.fillMaxSize().systemBarsPadding()) {
        when (s) {
            Screen.Home -> Home(vm)
            is Screen.New -> NewProject(vm, s)
            Screen.Processing -> Processing(vm)
            is Screen.Detail -> vm.project(s.projectId)?.let { Detail(vm, it) } ?: Home(vm)
        }
    }
}

@Composable
private fun Home(vm: ClipViewModel) {
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> uri?.let { vm.pick(it) } }
    Column(Modifier.fillMaxSize().padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).background(Brush.linearGradient(listOf(Violet, Color(0xFFD946EF)))),
                contentAlignment = Alignment.Center) { Icon(Icons.Default.PlayArrow, null, tint = Color.White) }
            Spacer(Modifier.width(10.dp))
            Text("ClipPilot", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        }
        Text("Une longue vidéo. Plusieurs clips. Zéro montage.", color = Color.Gray, modifier = Modifier.padding(top = 6.dp))
        Text("100 % sur votre téléphone : rien n'est envoyé sur Internet.", color = Color.Gray, style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(20.dp))
        Button(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly)) },
            modifier = Modifier.fillMaxWidth().height(56.dp), shape = RoundedCornerShape(14.dp)) {
            Icon(Icons.Default.Add, null); Spacer(Modifier.width(8.dp)); Text("Créer mes clips", fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(24.dp))
        Text("Mes projets", fontWeight = FontWeight.SemiBold)
        if (vm.projects.isEmpty()) {
            Text("Aucun projet. Choisissez une vidéo où l'on parle (podcast, interview, vlog…).", color = Color.Gray, modifier = Modifier.padding(top = 12.dp))
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(top = 12.dp)) {
            items(vm.projects, key = { it.id }) { p ->
                Card(Modifier.fillMaxWidth().clickable { vm.screen = Screen.Detail(p.id) }) {
                    Column(Modifier.padding(16.dp)) {
                        Text(p.name, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("${p.clips.size} clips · ${fmt(p.duration)} · ${DateFormat.getDateInstance().format(Date(p.createdAt))}",
                            color = Color.Gray, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

@Composable
private fun NewProject(vm: ClipViewModel, s: Screen.New) {
    var range by remember { mutableStateOf(30 to 45) }
    var count by remember { mutableIntStateOf(5) }
    var aspect by remember { mutableStateOf("9:16") }
    var height by remember { mutableIntStateOf(1080) }
    var style by remember { mutableStateOf("bold") }
    var subs by remember { mutableStateOf(true) }
    var crop by remember { mutableStateOf(true) }
    Column(Modifier.fillMaxSize().padding(20.dp).verticalScrollCompat()) {
        Text("Réglages", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text("${s.name} · ${fmt(s.duration)}", color = Color.Gray)
        Label("Durée des clips")
        Chips(listOf(15 to 30, 30 to 45, 45 to 60, 60 to 90), range, { "${it.first}–${it.second} s" }) { range = it }
        Label("Nombre de clips")
        Chips(listOf(3, 5, 10), count, { "$it" }) { count = it }
        Label("Format")
        Chips(listOf("9:16", "1:1", "16:9"), aspect, { it }) { aspect = it }
        Label("Qualité")
        Chips(listOf(720, 1080), height, { "${it}p" }) { height = it }
        Label("Sous-titres")
        Chips(SUB_STYLES.map { it.id }, style, { id -> SUB_STYLES.first { it.id == id }.name }) { style = it }
        Toggle("Incruster les sous-titres", subs) { subs = it }
        Toggle("Recadrage intelligent (visage)", crop) { crop = it }
        Spacer(Modifier.height(20.dp))
        Button(onClick = { vm.start(s.uri, s.name, Settings(range.first, range.second, count, aspect, height, style, subs, crop)) },
            modifier = Modifier.fillMaxWidth().height(56.dp), shape = RoundedCornerShape(14.dp)) { Text("Générer $count clips", fontWeight = FontWeight.SemiBold) }
        TextButton(onClick = { vm.screen = Screen.Home }, modifier = Modifier.fillMaxWidth()) { Text("Annuler") }
    }
}

@Composable
private fun Processing(vm: ClipViewModel) {
    Column(Modifier.fillMaxSize().padding(28.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        CircularProgressIndicator()
        Spacer(Modifier.height(24.dp))
        Text(vm.stage, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(12.dp))
        LinearProgressIndicator(progress = { vm.progress }, modifier = Modifier.fillMaxWidth())
        Text("${(vm.progress * 100).toInt()} %", color = Color.Gray, modifier = Modifier.padding(top = 8.dp))
        Text("Gardez l'application ouverte. Tout est calculé sur le téléphone.", color = Color.Gray,
            style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 16.dp))
        OutlinedButton(onClick = { vm.cancel() }, modifier = Modifier.padding(top = 24.dp)) { Text("Annuler") }
    }
}

@Composable
private fun Detail(vm: ClipViewModel, p: Project) {
    val ctx = LocalContext.current
    var playing by remember { mutableStateOf<String?>(p.clips.firstOrNull()?.file) }
    var editing by remember { mutableStateOf<Clip?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { vm.screen = Screen.Home }) { Icon(Icons.Default.ArrowBack, "Retour") }
            Text(p.name, Modifier.weight(1f), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            IconButton(onClick = { confirmDelete = true }) { Icon(Icons.Default.Delete, "Supprimer le projet") }
        }
        playing?.let { Player(it, p.settings.aspect) }
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(p.clips, key = { it.id }) { c ->
                Card(Modifier.fillMaxWidth().clickable { c.file?.let { playing = it } }) {
                    Column(Modifier.padding(14.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("${c.score}", color = if (c.score >= 75) Color(0xFF4ADE80) else Violet, fontWeight = FontWeight.Bold)
                            Spacer(Modifier.width(10.dp))
                            Text(c.title, Modifier.weight(1f), fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(fmt(c.end - c.start), color = Color.Gray)
                        }
                        Text(c.reason, color = Color.Gray, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
                        if (vm.busyClip == c.id) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 8.dp))
                        Row(Modifier.padding(top = 6.dp)) {
                            TextButton(enabled = c.file != null, onClick = {
                                c.file?.let { Gallery.save(ctx, File(it), c.title); Toast.makeText(ctx, "Enregistré dans Galerie › Movies/ClipPilot", Toast.LENGTH_SHORT).show() }
                            }) { Icon(Icons.Default.Download, null); Text(" Galerie") }
                            TextButton(enabled = c.file != null, onClick = { c.file?.let { Gallery.share(ctx, File(it)) } }) { Icon(Icons.Default.Share, null); Text(" Partager") }
                            TextButton(onClick = { editing = c }) { Icon(Icons.Default.Edit, null); Text(" Éditer") }
                        }
                    }
                }
            }
        }
    }
    editing?.let { c -> EditDialog(c, p.duration, onDismiss = { editing = null }, onDelete = { vm.deleteClip(p, c); editing = null }) { s, e, t ->
        vm.rerender(p, c, s, e, t); editing = null
    } }
    if (confirmDelete) AlertDialog(onDismissRequest = { confirmDelete = false },
        title = { Text("Supprimer ce projet ?") }, text = { Text("La vidéo et tous les clips de ce projet seront supprimés de l'application.") },
        confirmButton = { TextButton(onClick = { vm.delete(p) }) { Text("Supprimer", color = Color(0xFFF87171)) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Annuler") } })
}

@Composable
private fun EditDialog(c: Clip, max: Double, onDismiss: () -> Unit, onDelete: () -> Unit, onSave: (Double, Double, String) -> Unit) {
    var start by remember { mutableDoubleStateOf(c.start) }
    var end by remember { mutableDoubleStateOf(c.end) }
    var title by remember { mutableStateOf(c.title) }
    val ok = end - start in 3.0..180.0
    AlertDialog(onDismissRequest = onDismiss, title = { Text("Éditer le clip") }, text = {
        Column {
            OutlinedTextField(title, { title = it }, label = { Text("Titre") }, singleLine = true)
            Nudge("Début", start) { start = (start + it).coerceIn(0.0, max) }
            Nudge("Fin", end) { end = (end + it).coerceIn(0.0, max) }
            Text("Durée : ${"%.1f".format(end - start)} s", color = if (ok) Color.Gray else Color(0xFFF87171))
            TextButton(onClick = onDelete) { Text("Supprimer ce clip", color = Color(0xFFF87171)) }
        }
    }, confirmButton = { TextButton(enabled = ok && title.isNotBlank(), onClick = { onSave(start, end, title.trim()) }) { Text("Réexporter") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annuler") } })
}

@Composable
private fun Nudge(label: String, value: Double, onChange: (Double) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
        Text("$label ${fmt(value)}", Modifier.width(110.dp))
        listOf(-1.0, -0.2, 0.2, 1.0).forEach { d ->
            TextButton(onClick = { onChange(d) }, contentPadding = PaddingValues(4.dp)) { Text(if (d > 0) "+$d" else "$d") }
        }
    }
}

@Composable
private fun Player(path: String, aspect: String) {
    val ctx = LocalContext.current
    val player = remember { ExoPlayer.Builder(ctx).build() }
    LaunchedEffect(path) { player.setMediaItem(MediaItem.fromUri(Uri.fromFile(File(path)))); player.prepare(); player.playWhenReady = true }
    DisposableEffect(Unit) { onDispose { player.release() } }
    val ratio = when (aspect) { "1:1" -> 1f; "16:9" -> 16f / 9f; else -> 9f / 16f }
    Box(Modifier.fillMaxWidth().background(Color.Black), contentAlignment = Alignment.Center) {
        AndroidView({ PlayerView(it).apply { this.player = player } },
            Modifier.heightIn(max = 420.dp).aspectRatio(ratio))
    }
}

@Composable
private fun Label(text: String) = Text(text, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 18.dp, bottom = 8.dp))

@Composable
private fun <T> Chips(options: List<T>, selected: T, label: (T) -> String, onSelect: (T) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
        options.forEach { o ->
            FilterChip(selected = o == selected, onClick = { onSelect(o) }, label = { Text(label(o)) })
        }
    }
}

@Composable
private fun Toggle(text: String, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, Modifier.weight(1f)); Switch(value, onChange)
    }
}

@Composable
private fun Modifier.verticalScrollCompat(): Modifier = this.then(Modifier.verticalScroll(rememberScrollState()))

private fun fmt(sec: Double): String { val s = sec.toInt(); return "%d:%02d".format(s / 60, s % 60) }
