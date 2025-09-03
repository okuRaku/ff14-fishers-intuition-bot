const fishGuide = require('./fish-guide');

const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
GlobalFonts.registerFromPath('fonts/Montserrat-VariableFont_wght.ttf', 'MontSerrat')
GlobalFonts.registerFromPath('fonts/OpenSans-VariableFont_wdth,wght.ttf', 'OpenSans')
// --- helpers ---

const getCounts = (data, baitId, fishId, method = "bayesian") => {
    let catches = 0;
    let addedMisses = 0;
    let total = 0;

    for (const patch of Object.keys(data.rates)) {
        const perBait = data.rates[patch][baitId];
        if (!perBait) continue;

        for (const [, biterate] of Object.entries(perBait)) {
            total += biterate.catches;
            if (method !== "ignore") {
                total += biterate.bayesian_misses;
            }
        }

        const fishinfo = perBait[fishId];
        if (!fishinfo) continue;

        catches += fishinfo.catches;
        if (method === "bayesian") {
            addedMisses += fishinfo.bayesian_misses;
        }
    }

    return { catches, addedMisses, total };
};

const getCellColor = (pct) => {
    // dark = rgb(37,48,71), light = rgb(84,96,144)
    const min = [37, 48, 71];
    const max = [84, 96, 144];
    const t = Math.min(1, pct / 100);

    const r = Math.round(min[0] + t * (max[0] - min[0]));
    const g = Math.round(min[1] + t * (max[1] - min[1]));
    const b = Math.round(min[2] + t * (max[2] - min[2]));

    return `rgb(${r},${g},${b})`;
};

// --- helpful export ---
const biterateDataAvailable = async (locationId) => {
    const res = await fetch(`https://lodinn.github.io/assets/spot_data/${locationId}.json`, {method: "HEAD"})
    return res.ok
}

// --- main function ---

const renderSpot = async (locationId, cachedFishGuides) => {
    // fetch remote JSON
    const url = `https://lodinn.github.io/assets/spot_data/${locationId}.json`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    const data = await res.json();

    const baitIds = Object.keys(data.bait).sort((a, b) => Number(a) - Number(b));
    const fishIds = Object.keys(data.fish).sort(
        (a, b) => Number(data.fish[a].tug) - Number(data.fish[b].tug)
    );

    const colWidth = 85;
    const rowHeight = 70;
    const headerHeight = 85;
    const baitColWidth = 80;

    const width = baitColWidth + fishIds.length * colWidth;
    const height = headerHeight + baitIds.length * rowHeight;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // background
    ctx.fillStyle = "#1e2235";
    ctx.fillRect(0, 0, width, height);
    
    // watermark
    const watermark = await loadImage('https://lodinn.github.io/assets/WiseFish.png')
    ctx.drawImage(watermark, 8, 4, 45, watermark.width*45/watermark.height);

    // group boundaries
    const groups = [];
    let lastTug = null;
    let x = baitColWidth;
    for (const fishId of fishIds) {
        const tug = Number(data.fish[fishId].tug);
        if (lastTug !== null && tug !== lastTug) {
            groups.push(x);
        }
        lastTug = tug;
        x += colWidth;
    }

    // fish headers
    x = baitColWidth;
    for (const fishId of fishIds) {
        const fish = data.fish[fishId];
        const tug = Number(fish.tug);

        let color;
        if (tug === 1) color = "#8cba4a"; //modest
        else if (tug === 2) color = "#EB786C"; //ambitious
        else {
            // tug === 3 → lookup hooksetRaw
            console.log(`Resorting to allagan reports query for ${fishId}`)
            const result = await fishGuide.populateAllaganReportsData(
                fishId,
                cachedFishGuides
            );
            const hookset = result[fishId]?.hooksetRaw;
            color = hookset === 1 ? "#EB786C" : "#8cba4a";
        }

        const label = tug === 1 ? "!" : tug === 2 ? "!!" : "!!!";

        // strip
        const stripHeight = 20
        ctx.fillStyle = color;
        ctx.fillRect(x, 0, colWidth, stripHeight);

        ctx.fillStyle = "white";
        ctx.font = "800 17px 'OpenSans'";
        ctx.textAlign = "center";
        ctx.fillText(label, x + colWidth / 2, 15);

        // fish icon
        const fishIconUrl = `https://lodinn.github.io/assets/item_icons/${fishId}.png`;
        try {
            const img = await loadImage(fishIconUrl);
            const fishSize = Math.floor(rowHeight * 0.8);
            const iconY = stripHeight + ((headerHeight - stripHeight) - fishSize) / 2;
            ctx.drawImage(img, x + (colWidth - fishSize) / 2, iconY, fishSize, fishSize);
            ctx.drawImage(img, x + (colWidth - fishSize) / 2, 22, fishSize, fishSize);
        } catch {
            ctx.fillStyle = "gray";
            ctx.fillRect(x + (colWidth - 48) / 2, 25, 48, 48);
        }

        x += colWidth;
    }

    // bait rows
    let y = headerHeight;
    for (const baitId of baitIds) {
        // bait icon
        const baitIconUrl = `https://lodinn.github.io/assets/item_icons/${baitId}.png`;
        try {
            const baitImg = await loadImage(baitIconUrl);
            const baitSize = Math.floor(rowHeight * 0.8); // 80% of row height
            ctx.drawImage(
                baitImg,
                (baitColWidth - baitSize) / 2,
                y + (rowHeight - baitSize) / 2,
                baitSize,
                baitSize
            );
        } catch {
            ctx.fillStyle = "gray";
            ctx.fillRect(
                (baitColWidth - 40) / 2,
                y + (rowHeight - 40) / 2,
                40,
                40
            );
        }

        // cells
        let cx = baitColWidth;
        for (const fishId of fishIds) {
            const { catches, addedMisses, total } = getCounts(
                data,
                baitId,
                fishId,
                "bayesian"
            );
            if (catches + addedMisses > 0) {
                const pct = ((catches + addedMisses) / total) * 100;
                const fishinfo = Object.values(data.rates)[0][baitId]?.[fishId];
                const low = fishinfo?.bitetime_low;
                const high = fishinfo?.bitetime_high;

                // background shade
                ctx.fillStyle = getCellColor(pct);
                ctx.fillRect(cx, y, colWidth, rowHeight);

                ctx.fillStyle = "white";
                ctx.textAlign = "center";

                // pct
                ctx.font = "600 19px 'Montserrat'";
                ctx.fillText(
                    pct.toFixed(1) + "%",
                    cx + colWidth / 2,
                    y + rowHeight / 2 - 7
                );

                // divider
                ctx.strokeStyle = "white";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(cx + 4, y + rowHeight / 2);
                ctx.lineTo(cx + colWidth - 4, y + rowHeight / 2);
                ctx.stroke();

                // range
                if (low !== undefined && high !== undefined) {
                    ctx.font = "18px 'Montserrat'";
                    ctx.fillText(
                        `${low}–${high}`,
                        cx + colWidth / 2,
                        y + rowHeight / 2 + 18
                    );
                }
            }

            // faint grid lines
            ctx.strokeStyle = "rgba(255,255,255,0.05)";
            ctx.lineWidth = 1;
            ctx.strokeRect(cx, y, colWidth, rowHeight);

            cx += colWidth;
        }

        y += rowHeight;
    }

    // vertical dividers
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1;
    for (const gx of groups) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, height);
        ctx.stroke();
    }
    console.log(`Bite rate canvas for ${locationId} generated`);
    return canvas;
};

// --- exports ---

module.exports = {
    renderSpot: renderSpot,
    biterateDataAvailable: biterateDataAvailable
};

