package com.clippilot.app

import java.text.Normalizer
import java.util.UUID
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.roundToInt

/**
 * Finds the best moments in a transcript (port of the server-side engine).
 * Vosk gives no punctuation, so sentences are split on pauses.
 * The score is an indicative heuristic, never a promise of virality.
 */
object Analyzer {
    private data class Sentence(val words: List<Word>) {
        val start get() = words.first().start
        val end get() = words.last().end
        val text get() = words.joinToString(" ") { it.text }
    }

    private val HOOKS = linkedMapOf(
        "Question" to Regex("^(pourquoi|comment|est ce que|qu est ce|quel|quelle|quels|combien|savez vous|vous savez|tu sais|why|how|what|did you|do you|have you)\\b"),
        "Surprise" to Regex("\\b(incroyable|personne ne|la verite|choquant|jamais vu|vous n allez pas|you won t believe|nobody|the truth|crazy|insane)\\b"),
        "Anecdote" to Regex("^(un jour|quand j etais|je me souviens|il y a \\w+ ans|l histoire|one day|when i was|i remember|years ago)\\b"),
        "Affirmation forte" to Regex("\\b(la plus grosse erreur|le meilleur|le pire|tout le monde|arretez de|il faut arreter|the biggest mistake|the best|the worst|everyone|stop doing)\\b"),
        "Curiosité" to Regex("\\b(voici pourquoi|voila pourquoi|le secret|la raison|ce que personne|here s why|the secret|the reason)\\b"),
        "Chiffre clé" to Regex("\\b(\\d+|cent|mille|million|millions|milliard|pour cent)\\b"),
    )
    private val CONNECTOR = Regex("^(et|mais|donc|alors|du coup|parce que|car|puis|ensuite|enfin|bref|and|but|so|because|then|also)\\b")
    private val DANGLING = Regex("^(il|elle|ils|elles|ca|cela|ce|it|that|this|they|he|she)\\b")
    private val EMOTION = Regex("\\b(incroyable|fou|dingue|genial|terrible|peur|adore|deteste|enorme|honte|fier|amazing|crazy|love|hate|wow)\\b")
    private val EXPLAIN = Regex("\\b(parce que|c est a dire|en fait|par exemple|la cle|l astuce|etape|because|for example|the key|step)\\b")
    private val ADDRESS = Regex("\\b(vous|tu|toi|votre|vos|ton|ta|tes|you|your)\\b")
    private val FILLERS = setOf("euh", "heu", "hum", "bah", "ben", "um", "uh")
    private val STOP = ("le la les un une des de du et a au aux en dans sur pour par avec ce cet cette ces se sa son ses " +
        "qui que quoi est sont etre avoir ai as avons avez ont fait je tu il elle on nous vous ils elles me te ne pas plus " +
        "tres tout tous mais donc ou si alors comme ca oui non bon bien voila the and of to in is it that you i").split(" ").toSet()

    fun norm(s: String): String = Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD)
        .replace(Regex("\\p{M}+"), "").replace(Regex("[^a-z0-9 ]"), " ").replace(Regex("\\s+"), " ").trim()

    private fun content(s: String) = norm(s).split(" ").filter { it.length > 2 && it !in STOP && it !in FILLERS }

    private fun sentences(words: List<Word>): List<Sentence> {
        val out = ArrayList<Sentence>()
        var cur = ArrayList<Word>()
        for ((i, w) in words.withIndex()) {
            cur.add(w)
            val gap = if (i + 1 < words.size) words[i + 1].start - w.end else 99.0
            val long = cur.last().end - cur.first().start > 14 && gap > 0.25
            if (gap >= 0.6 || long || i == words.lastIndex) { out.add(Sentence(cur)); cur = ArrayList() }
        }
        return out
    }

    private class Cand(val s: List<Sentence>) {
        val start get() = s.first().start
        val end get() = s.last().end
        val dur get() = end - start
        val text get() = s.joinToString(" ") { it.text }
        var score = 0.0
        var hook: String? = null
        val reasons = ArrayList<String>()
    }

    fun select(words: List<Word>, minSec: Int, maxSec: Int, count: Int, videoDuration: Double): List<Clip> {
        val sents = sentences(words)
        if (sents.isEmpty()) return emptyList()
        val topic = HashMap<String, Int>()
        content(words.joinToString(" ") { it.text }).forEach { topic[it] = (topic[it] ?: 0) + 1 }
        topic.entries.removeIf { it.value < 2 }
        val topicTotal = topic.values.sum().coerceAtLeast(1)

        val cands = ArrayList<Cand>()
        for (i in sents.indices) for (j in i until sents.size) {
            val d = sents[j].end - sents[i].start
            if (d > maxSec + 2) break
            if (d >= minSec) cands.add(Cand(sents.subList(i, j + 1)))
        }
        if (cands.isEmpty() && sents.last().end - sents.first().start >= 8) cands.add(Cand(sents))

        for (c in cands) {
            val first = norm(c.s.first().text)
            var hook = 0.25
            for ((name, re) in HOOKS) if (re.containsMatchIn(first.take(140))) { hook = 0.9; c.hook = name; c.reasons.add("Accroche : $name"); break }
            val context = 1.0 - (if (DANGLING.containsMatchIn(first)) 0.4 else 0.0) - (if (CONNECTOR.containsMatchIn(first)) 0.3 else 0.0)
            if (context >= 0.9) c.reasons.add("Compréhensible sans contexte")
            val txt = norm(c.text)
            val cw = content(c.text)
            val topicHits = cw.toSet().sumOf { topic[it] ?: 0 }.toDouble() / topicTotal
            val emo = EMOTION.findAll(txt).count()
            val expl = EXPLAIN.findAll(txt).count()
            val addr = ADDRESS.findAll(txt).count()
            if (emo > 0) c.reasons.add("Moment chargé en émotion")
            if (expl > 0) c.reasons.add("Contient une explication")
            val interest = (0.35 * (topicHits * 12).coerceAtMost(1.0) + 0.2 * cw.toSet().size / cw.size.coerceAtLeast(1) +
                0.2 * (emo / 2.0).coerceAtMost(1.0) + 0.15 * (expl / 2.0).coerceAtMost(1.0) + 0.1 * (addr / 3.0).coerceAtMost(1.0)) / 0.9
            val ws = c.s.flatMap { it.words }
            val wps = ws.size / c.dur.coerceAtLeast(1.0)
            val pauses = ws.zipWithNext().count { (a, b) -> b.start - a.end > 1.2 }
            val fill = ws.count { norm(it.text) in FILLERS }
            val rhythm = (1 - (abs(wps - 2.9) / 2.2).coerceAtMost(1.0) - 0.12 * pauses - 0.05 * fill).coerceIn(0.0, 1.0)
            if (wps >= 2.6 && pauses == 0) c.reasons.add("Rythme soutenu")
            val mid = (minSec + maxSec) / 2.0
            val length = (1 - abs(c.dur - mid) / ((maxSec - minSec) / 2.0 * 2.5).coerceAtLeast(1.0)).coerceAtLeast(0.0)
            c.score = 0.30 * hook + 0.22 * interest + 0.18 * context.coerceAtLeast(0.0) + 0.18 * rhythm + 0.12 * length
        }

        cands.sortByDescending { it.score }
        val chosen = ArrayList<Cand>()
        for (c in cands) {
            if (chosen.size >= count) break
            val overlap = chosen.any { o -> (minOf(c.end, o.end) - maxOf(c.start, o.start)) / minOf(c.dur, o.dur) > 0.15 }
            val similar = chosen.any { o ->
                val a = content(c.text).toSet(); val b = content(o.text).toSet()
                a.isNotEmpty() && b.isNotEmpty() && (a intersect b).size.toDouble() / (a union b).size > 0.55
            }
            if (!overlap && !similar) chosen.add(c)
        }
        return chosen.map { c ->
            val titleWords = c.s.first().text.split(" ").filter { norm(it) !in FILLERS }.take(8)
            var title = titleWords.joinToString(" ").replaceFirstChar { it.uppercase() }
            if (c.s.first().words.size > 8) title += "…"
            Clip(
                id = UUID.randomUUID().toString(),
                title = title.ifBlank { "Clip" },
                start = (c.start - 0.15).coerceAtLeast(0.0),
                end = (c.end + 0.25).coerceAtMost(videoDuration),
                score = (100 / (1 + exp(-7 * (c.score - 0.52)))).roundToInt().coerceIn(5, 98),
                hook = c.hook,
                reason = c.reasons.distinct().take(4).joinToString(" · ").ifEmpty { "Passage cohérent et bien rythmé" },
                transcript = c.text,
                file = null,
            )
        }
    }
}
