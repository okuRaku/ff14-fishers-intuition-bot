const Fuse = require('fuse.js')

const normalize = (str) => {
    return str.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
}

const getFruityGuideCandidates = (sentence, guide, maxCandidates = 10) => {
    const dictionary = Object.keys(guide).map(key => {
        return {
            name: guide[key].name.en,
            id: key
        }
    })
    const normalizedSentence = normalize(sentence);
    const words = normalizedSentence.split(/\s+/);
    const results = new Set();

    // --- 1️⃣ Exact matches first ---
    for (const word of words) {
        for (const fish of dictionary) {
            if (normalize(fish.name) === word) {
                results.add(fish);
                if (results.size >= maxCandidates) {
                    return Array.from(results);
                }
            }
        }
    }

    // --- 2️⃣ Sub-word matches (skip stopwords / very short words) ---
    const stopwords = new Set(["the", "of", "a", "an", "all", "and", "in"]);
    for (const word of words) {
        if (word.length < 2 || stopwords.has(word)) continue;

        for (const fish of dictionary) {
            const fishWords = normalize(fish.name).split(/\s+/);
            if (fishWords.includes(word)) {
                results.add(fish);
            }
        }
    }


    // --- 3️⃣ Fuse.js search per word ---
    const fuse = new Fuse(dictionary, {
        keys: ["name"],
        includeScore: true, // default threshold 0.6
        ignoreLocation: true,
        threshold: 0.6
    });

    // Collect all matches with scores
    const scoredMatches = [];

    for (const word of words) {
        if (word.length < 3 || stopwords.has(word)) continue;

        for (const m of fuse.search(word)) {
            const a = word.toLowerCase();
            const b = m.item.name.toLowerCase();
            let matches = 0;
            const bChars = b.split('');
            for (const char of a) {
                const idx = bChars.indexOf(char);
                if (idx >= 0) {
                    matches++;
                    bChars.splice(idx, 1); // avoid double-counting
                }
            }
            const ratio = matches / Math.max(a.length, b.length);
            // bonus: massive for 70%+ letter overlap, small otherwise
            const bonus = ratio >= 0.7 ? -2 : -0.05 * a.length;

            const adjustedScore = m.score + bonus;

            scoredMatches.push({ ...m, adjustedScore });
        }
    }

    // Sort by adjustedScore ascending (lower is better)
    scoredMatches.sort((a, b) => a.adjustedScore - b.adjustedScore);

    // Add top matches to results until full
    for (const m of scoredMatches) {
        if (results.size >= maxCandidates) break;
        results.add(m.item);
    }
    return Array.from(results);
}

module.exports = {
    getFruityGuideCandidates
};
