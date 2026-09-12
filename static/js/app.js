/**
 * WANDERLORE - Frontend Controller & Personalization Engine
 */

// Application State
let spots = [];
let expeditions = [];
let discussions = [];
let activeCategory = "All";
let minSolitude = 70;
let searchQuery = "";
let currentSpot = null;
let map = null;
let markersLayer = null;
let currentUsername = localStorage.getItem("wanderlore_user") || "purvaj";
let currentUserProfile = null;
let bookmarkedSpotIds = new Set();
let unlockedSpots = JSON.parse(localStorage.getItem("wanderlore_unlocked") || "[]");
let userNotesCount = parseInt(localStorage.getItem("wanderlore_notes_count") || "0");

// Ambient Audio Engine (Web Audio API - Generative Synthesizer)
let audioCtx = null;
let audioIsPlaying = false;
let audioGain = null;
let audioNoiseNode = null;
let audioFilterNode = null;
let audioLfo = null;

// Initialization on DOM Ready
document.addEventListener("DOMContentLoaded", async () => {
    initMap();
    setupEventListeners();
    await loadUserProfile();
    await fetchStats();
    await loadBookmarks();
    await loadSpots();
    await loadExpeditions();
    await loadDiscussions();
    lucide.createIcons();
});

// ============================================================
// 1. PERSONALIZATION & PROFILES
// ============================================================
async function loadUserProfile() {
    try {
        const res = await fetch(`/api/profile?username=${encodeURIComponent(currentUsername)}`);
        if (res.ok) {
            currentUserProfile = await res.json();
            updateProfileUI();
        }
    } catch (e) {
        console.error("Failed to load user profile", e);
    }
}

function updateProfileUI() {
    if (!currentUserProfile) return;

    // Header & Persona Label
    const label = document.getElementById("persona-name-label");
    const avatarLetter = document.getElementById("persona-avatar-letter");
    if (label) label.innerText = currentUserProfile.display_name;
    if (avatarLetter) avatarLetter.innerText = currentUserProfile.display_name.charAt(0).toUpperCase();

    // Banner Welcome
    const bUser = document.getElementById("banner-username");
    const bTitle = document.getElementById("banner-user-title");
    if (bUser) bUser.innerText = currentUserProfile.display_name;
    if (bTitle) bTitle.innerText = currentUserProfile.title;

    // Passport View
    const pName = document.getElementById("passport-display-name");
    const pTitle = document.getElementById("passport-title");
    const pBio = document.getElementById("passport-bio");
    if (pName) pName.innerText = currentUserProfile.display_name;
    if (pTitle) pTitle.innerText = currentUserProfile.title;
    if (pBio) pBio.innerText = currentUserProfile.bio;

    // Prefill Profile Modal
    const pInputName = document.getElementById("prof-name");
    const pInputTitle = document.getElementById("prof-title");
    const pInputBio = document.getElementById("prof-bio");
    const pInputCats = document.getElementById("prof-categories");
    const pInputSol = document.getElementById("prof-solitude");
    const pInputDec = document.getElementById("prof-decibel");
    const pSolVal = document.getElementById("prof-sol-val");
    const pDecVal = document.getElementById("prof-dec-val");

    if (pInputName) pInputName.value = currentUserProfile.display_name;
    if (pInputTitle) pInputTitle.value = currentUserProfile.title;
    if (pInputBio) pInputBio.value = currentUserProfile.bio;
    if (pInputCats) pInputCats.value = currentUserProfile.preferred_categories;
    if (pInputSol) {
        pInputSol.value = currentUserProfile.min_solitude_pref;
        if (pSolVal) pSolVal.innerText = `${currentUserProfile.min_solitude_pref}%`;
    }
    if (pInputDec) {
        pInputDec.value = currentUserProfile.max_decibel_pref;
        if (pDecVal) pDecVal.innerText = `${currentUserProfile.max_decibel_pref} dB`;
    }
}

function togglePersonaMenu() {
    const menu = document.getElementById("persona-menu");
    if (menu) menu.classList.toggle("hidden");
}

async function selectPersona(username) {
    currentUsername = username;
    localStorage.setItem("wanderlore_user", username);
    togglePersonaMenu();
    await loadUserProfile();
    await loadBookmarks();
    await loadSpots();
    showToast(`Switched active explorer persona to ${currentUserProfile.display_name}`, "user-check");
}

function openProfileModal() {
    const modal = document.getElementById("profile-modal");
    if (modal) {
        modal.classList.remove("hidden");
        modal.classList.add("flex");
    }
    const menu = document.getElementById("persona-menu");
    if (menu) menu.classList.add("hidden");
}

function closeProfileModal() {
    const modal = document.getElementById("profile-modal");
    if (modal) {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
    }
}

async function handleProfileSave(e) {
    e.preventDefault();
    const name = document.getElementById("prof-name").value.trim();
    const title = document.getElementById("prof-title").value.trim();
    const bio = document.getElementById("prof-bio").value.trim();
    const cats = document.getElementById("prof-categories").value.trim();
    const sol = parseInt(document.getElementById("prof-solitude").value);
    const dec = parseInt(document.getElementById("prof-decibel").value);

    try {
        const res = await fetch("/api/profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: currentUsername,
                display_name: name,
                title: title,
                bio: bio,
                preferred_categories: cats,
                min_solitude_pref: sol,
                max_decibel_pref: dec
            })
        });

        const data = await res.json();
        if (data.success) {
            currentUserProfile = data.profile;
            updateProfileUI();
            closeProfileModal();
            loadSpots();
            showToast("Explorer identity & preferences updated!", "check-circle");
        }
    } catch (err) {
        console.error("Save profile error", err);
    }
}

// ============================================================
// 2. MAP ENGINE (Leaflet.js)
// ============================================================
function initMap() {
    map = L.map('sanctuary-map', {
        center: [34.0, 15.0],
        zoom: 3,
        minZoom: 2,
        maxZoom: 16,
        zoomControl: true
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);
}

function renderMapMarkers(spotsToRender) {
    if (!map || !markersLayer) return;
    markersLayer.clearLayers();

    const bounds = [];

    spotsToRender.forEach(spot => {
        const isProtected = spot.is_protected && !unlockedSpots.includes(spot.id);
        const lat = isProtected ? spot.display_lat : spot.latitude;
        const lng = isProtected ? spot.display_lng : spot.longitude;

        bounds.push([lat, lng]);

        const pinIcon = L.divIcon({
            className: 'custom-sanctuary-pin',
            html: `
                <div class="pin-beacon ${isProtected ? 'protected' : ''}" title="${escapeHtml(spot.name)}">
                    <div class="pin-pulse"></div>
                    <div class="pin-core"></div>
                </div>
            `,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        });

        const marker = L.marker([lat, lng], { icon: pinIcon });

        const popupContent = `
            <div class="space-y-1.5 min-w-[210px]">
                <div class="flex items-center justify-between text-[10px] font-mono">
                    <span class="text-amberGold-400 uppercase tracking-wider">${escapeHtml(spot.category)}</span>
                    <span class="text-emeraldGlow-400 font-bold">${spot.match_percentage}% Match</span>
                </div>
                <div class="font-cinzel font-bold text-slate-100 text-sm">${escapeHtml(spot.name)}</div>
                <div class="text-xs text-slate-400">${escapeHtml(spot.region)}, ${escapeHtml(spot.country)}</div>
                <div class="flex items-center gap-2 pt-1 text-[11px] font-mono">
                    <span class="text-emeraldGlow-400">Solitude: ${spot.solitude_score}%</span>
                    <span class="text-sky-400">${spot.decibel_level} dB</span>
                </div>
                <button onclick="openSpotDetail(${spot.id})" class="mt-2 w-full py-1 rounded bg-amberGold-500 hover:bg-amberGold-400 text-obsidian-950 font-mono font-bold text-[10px] uppercase">
                    Inspect Sanctuary
                </button>
            </div>
        `;

        marker.bindPopup(popupContent);
        markersLayer.addLayer(marker);
    });

    if (bounds.length > 0 && map) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 8 });
    }
}

// ============================================================
// 3. SANCTUARY DATA & RECOMMENDATIONS
// ============================================================
async function loadSpots() {
    try {
        let url = `/api/spots?username=${encodeURIComponent(currentUsername)}&min_solitude=${minSolitude}`;
        if (activeCategory && activeCategory !== "All") {
            url += `&category=${encodeURIComponent(activeCategory)}`;
        }
        if (searchQuery) {
            url += `&q=${encodeURIComponent(searchQuery)}`;
        }

        const res = await fetch(url);
        spots = await res.json();

        // Update match summary on banner
        const highMatches = spots.filter(s => s.match_percentage >= 85).length;
        const bannerSummary = document.getElementById("banner-match-summary");
        if (bannerSummary && currentUserProfile) {
            bannerSummary.innerText = `Found ${highMatches} sanctuaries with 85%+ match to your ${currentUserProfile.preferred_categories.split(',')[0]} vibe.`;
        }

        renderSpotsList(spots);
        renderMapMarkers(spots);
        updateVaultList();
        lucide.createIcons();
    } catch (err) {
        console.error("Failed to fetch spots:", err);
        showToast("Error retrieving sanctuaries from database", "alert-circle");
    }
}

function renderSpotsList(spotItems) {
    const container = document.getElementById("spots-list");
    const countBadge = document.getElementById("spots-count-badge");
    if (!container) return;

    if (countBadge) {
        countBadge.innerText = `${spotItems.length} sanctuaries mapped`;
    }

    if (spotItems.length === 0) {
        container.innerHTML = `
            <div class="p-8 text-center rounded-xl bg-obsidian-900 border border-slate-800 space-y-2">
                <i data-lucide="compass" class="w-8 h-8 text-slate-600 mx-auto"></i>
                <div class="font-cinzel text-slate-300">No Sanctuaries Match Your Criteria</div>
                <p class="text-xs text-slate-500">Try lowering your solitude threshold or resetting the category filter.</p>
                <button onclick="resetFilters()" class="px-3 py-1.5 rounded bg-slate-800 text-xs font-mono text-amberGold-400 hover:bg-slate-700">
                    Reset Filters
                </button>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    container.innerHTML = spotItems.map(spot => {
        const isProtected = spot.is_protected && !unlockedSpots.includes(spot.id);
        const isBookmarked = bookmarkedSpotIds.has(spot.id);

        return `
            <div class="spot-card bg-obsidian-900 border border-slate-800/90 rounded-xl overflow-hidden cursor-pointer group" onclick="openSpotDetail(${spot.id})">
                <div class="flex flex-col sm:flex-row h-full">
                    <!-- Thumbnail -->
                    <div class="relative w-full sm:w-44 h-36 sm:h-auto shrink-0 overflow-hidden">
                        <img src="${escapeHtml(spot.image_url)}" alt="${escapeHtml(spot.name)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                        <div class="absolute inset-0 bg-gradient-to-t sm:bg-gradient-to-r from-obsidian-950/80 via-transparent to-transparent"></div>
                        
                        <!-- Category Badge -->
                        <div class="absolute top-2 left-2 px-2 py-0.5 rounded bg-obsidian-950/80 border border-slate-700 text-[10px] font-mono text-amberGold-400">
                            ${escapeHtml(spot.category)}
                        </div>

                        <!-- Bookmark Quick Toggle -->
                        <button onclick="event.stopPropagation(); toggleBookmark(${spot.id})" title="Save to Journey"
                                class="absolute top-2 right-2 w-7 h-7 rounded-full bg-obsidian-950/80 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-amberGold-400 transition-colors">
                            <i data-lucide="bookmark" class="w-3.5 h-3.5 ${isBookmarked ? 'bookmark-active' : ''}"></i>
                        </button>
                    </div>

                    <!-- Details -->
                    <div class="p-3.5 flex-1 flex flex-col justify-between space-y-2">
                        <div>
                            <div class="flex items-start justify-between gap-2">
                                <h4 class="font-cinzel font-bold text-slate-100 text-sm group-hover:text-amberGold-400 transition-colors">
                                    ${escapeHtml(spot.name)}
                                </h4>
                                
                                <!-- Personalized Match Tag -->
                                <span class="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold text-amberGold-400 match-tag flex items-center gap-1">
                                    <i data-lucide="sparkles" class="w-2.5 h-2.5"></i>
                                    ${spot.match_percentage}% Match
                                </span>
                            </div>

                            <div class="text-xs text-slate-400 font-mono flex items-center gap-1 mt-0.5">
                                <i data-lucide="map-pin" class="w-3 h-3 text-slate-500"></i>
                                ${escapeHtml(spot.region)}, ${escapeHtml(spot.country)}
                            </div>

                            <!-- Personalized Match Reason -->
                            <div class="text-[11px] font-mono text-emeraldGlow-400/90 mt-1 flex items-center gap-1">
                                <i data-lucide="check" class="w-3 h-3"></i>
                                ${escapeHtml(spot.match_reason)}
                            </div>

                            <p class="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                                ${escapeHtml(spot.tagline)}
                            </p>
                        </div>

                        <div class="flex items-center justify-between pt-2 border-t border-slate-800 text-[11px] font-mono">
                            <div class="flex items-center gap-3">
                                <span class="text-emeraldGlow-400" title="Solitude Index">
                                    <i data-lucide="shield" class="w-3 h-3 inline mr-0.5"></i> ${spot.solitude_score}%
                                </span>
                                <span class="text-sky-400" title="Quietness Decibel">
                                    <i data-lucide="volume-2" class="w-3 h-3 inline mr-0.5"></i> ${spot.decibel_level} dB
                                </span>
                            </div>

                            <div class="flex items-center gap-2">
                                ${isProtected ? `
                                    <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-amberGold-500/10 text-amberGold-400 border border-amberGold-500/30 flex items-center gap-1">
                                        <i data-lucide="lock" class="w-3 h-3"></i> Riddle Gated
                                    </span>
                                ` : `
                                    <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-emeraldGlow-500/10 text-emeraldGlow-400 border border-emeraldGlow-500/30 flex items-center gap-1">
                                        <i data-lucide="unlock" class="w-3 h-3"></i> Open GPS
                                    </span>
                                `}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join("");
}

// ============================================================
// 4. SPOT DETAIL & RIDDLE QUEST
// ============================================================
async function openSpotDetail(spotId) {
    try {
        const res = await fetch(`/api/spots/${spotId}?username=${encodeURIComponent(currentUsername)}`);
        currentSpot = await res.json();

        // Populate Modal Fields
        document.getElementById("modal-img").src = currentSpot.image_url;
        document.getElementById("modal-title").innerText = currentSpot.name;
        document.getElementById("modal-category").innerText = currentSpot.category;
        document.getElementById("modal-region").innerText = `${currentSpot.region}, ${currentSpot.country}`;
        document.getElementById("modal-upvotes-count").innerText = currentSpot.upvotes;
        document.getElementById("modal-solitude").innerText = `${currentSpot.solitude_score}/100`;
        document.getElementById("modal-decibel").innerText = `${currentSpot.decibel_level} dB`;
        document.getElementById("modal-signal").innerText = currentSpot.cell_signal;
        document.getElementById("modal-traffic").innerText = currentSpot.crowd_factor;
        document.getElementById("modal-lore").innerText = currentSpot.lore;
        document.getElementById("modal-guardian-name").innerText = currentSpot.guardian_name;
        document.getElementById("modal-guardian-title").innerText = currentSpot.guardian_title;
        document.getElementById("modal-lnt").innerText = currentSpot.leave_no_trace_notes;

        // Personal match banner inside modal
        const matchPercent = document.getElementById("modal-match-percent");
        const matchReason = document.getElementById("modal-match-reason");
        if (matchPercent) matchPercent.innerText = `${currentSpot.match_percentage || 95}% Match`;
        if (matchReason) matchReason.innerText = currentSpot.match_reason || "Matches your solitude vibe";

        // Bookmark status
        updateModalBookmarkUI();

        // Personal Note
        const noteInput = document.getElementById("modal-personal-note-input");
        if (noteInput) noteInput.value = currentSpot.personal_note || "";

        renderCoordinatesSection();
        renderFieldNotes(currentSpot.notes || []);

        const modal = document.getElementById("spot-detail-modal");
        modal.classList.remove("hidden");
        modal.classList.add("flex");
        lucide.createIcons();
    } catch (err) {
        console.error("Error loading spot detail", err);
        showToast("Unable to load sanctuary details", "alert-circle");
    }
}

function closeSpotDetailModal() {
    const modal = document.getElementById("spot-detail-modal");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
    currentSpot = null;
}

function updateModalBookmarkUI() {
    if (!currentSpot) return;
    const isBookmarked = bookmarkedSpotIds.has(currentSpot.id);
    const icon = document.getElementById("modal-bookmark-icon");
    const label = document.getElementById("modal-bookmark-label");

    if (label) label.innerText = isBookmarked ? "Saved" : "Save";
    if (icon) {
        if (isBookmarked) {
            icon.classList.add("bookmark-active");
        } else {
            icon.classList.remove("bookmark-active");
        }
    }
}

function renderCoordinatesSection() {
    const section = document.getElementById("coordinates-section");
    if (!currentSpot || !section) return;

    const isAlreadyUnlocked = !currentSpot.is_protected || unlockedSpots.includes(currentSpot.id);

    if (isAlreadyUnlocked) {
        section.className = "rounded-xl border border-emeraldGlow-500/30 bg-emeraldGlow-950/20 p-5 space-y-3";
        section.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 text-emeraldGlow-400 font-mono text-xs font-bold">
                    <i data-lucide="unlock" class="w-4 h-4"></i>
                    AUTHENTICATED WAYPOINT (PRESERVE ETHOS)
                </div>
                <span class="text-[10px] font-mono text-slate-400">Leave No Trace Verified</span>
            </div>
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-obsidian-950 p-3 rounded-lg border border-slate-800">
                <div class="font-mono text-sm text-slate-200">
                    <span class="text-slate-500">COORDS:</span> ${currentSpot.latitude.toFixed(4)}° N, ${currentSpot.longitude.toFixed(4)}° E
                </div>
                <div class="flex items-center gap-2">
                    <a href="https://www.google.com/maps/search/?api=1&query=${currentSpot.latitude},${currentSpot.longitude}" target="_blank" rel="noopener noreferrer"
                       class="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-amberGold-400 text-xs font-mono flex items-center gap-1">
                        <i data-lucide="external-link" class="w-3.5 h-3.5"></i> Maps Jump
                    </a>
                    <button onclick="downloadGPX(${currentSpot.id})" class="px-3 py-1.5 rounded bg-emeraldGlow-500 hover:bg-emeraldGlow-400 text-obsidian-950 font-bold text-xs font-mono flex items-center gap-1">
                        <i data-lucide="download" class="w-3.5 h-3.5"></i> GPX Waypoint
                    </button>
                </div>
            </div>
        `;
    } else {
        section.className = "rounded-xl border border-amberGold-500/30 bg-amberGold-950/20 p-5 space-y-3";
        section.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 text-amberGold-400 font-mono text-xs font-bold">
                    <i data-lucide="shield-alert" class="w-4 h-4"></i>
                    FRAGILE SANCTUARY — COORDINATES RIDDLE-GATED
                </div>
                <div class="flex items-center gap-2">
                    <!-- 1-Click Demo Helper Button -->
                    <button onclick="autoFillRiddleDemo()" class="px-2.5 py-1 rounded bg-amberGold-500/20 hover:bg-amberGold-500/30 border border-amberGold-500/40 text-[10px] font-mono text-amberGold-300 font-semibold" title="Populate answer keyword for testing">
                        ⚡ Demo Auto-Fill
                    </button>
                    <span class="text-[10px] font-mono text-amberGold-500/80 hidden sm:inline">Anti-Overtourism Protection</span>
                </div>
            </div>
            <p class="text-xs text-slate-300">
                To protect this fragile haven from mass tourist exploitation, solve the guardian's riddle hidden in the lore above.
            </p>
            <div class="bg-obsidian-950 p-3.5 rounded-lg border border-slate-800 space-y-2">
                <div class="text-xs font-mono text-slate-200 font-semibold flex items-center gap-2">
                    <i data-lucide="help-circle" class="w-4 h-4 text-amberGold-400"></i>
                    ${escapeHtml(currentSpot.riddle_question || "What natural element shelters this sanctuary?")}
                </div>
                <div class="flex gap-2">
                    <input id="riddle-answer-input" type="text" placeholder="Type answer keyword from the lore..."
                           class="flex-1 bg-obsidian-900 border border-slate-700 px-3 py-2 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-amberGold-500">
                    <button onclick="submitRiddleSolution()" class="px-4 py-2 rounded-lg bg-amberGold-500 hover:bg-amberGold-400 text-obsidian-950 font-bold text-xs font-mono uppercase transition-colors">
                        Solve Lore
                    </button>
                </div>
                <div id="riddle-hint-box" class="hidden text-[11px] font-mono text-amberGold-300/80 pt-1">
                    <span class="text-slate-500">Guardian Whisper:</span> <span id="riddle-hint-text"></span>
                </div>
            </div>
        `;
    }
}

// 1-Click Demo Helper
function autoFillRiddleDemo() {
    if (!currentSpot) return;
    const input = document.getElementById("riddle-answer-input");
    if (input && currentSpot.riddle_answer) {
        input.value = currentSpot.riddle_answer;
        showToast(`Auto-filled keyword: "${currentSpot.riddle_answer}". Click "Solve Lore"!`, "sparkles");
    }
}

async function submitRiddleSolution() {
    const input = document.getElementById("riddle-answer-input");
    if (!input || !currentSpot) return;

    const answer = input.value.trim();
    if (!answer) {
        showToast("Please enter an answer to solve the riddle", "alert-circle");
        return;
    }

    try {
        const res = await fetch(`/api/spots/${currentSpot.id}/unlock`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answer: answer })
        });

        const data = await res.json();
        if (data.success) {
            if (!unlockedSpots.includes(currentSpot.id)) {
                unlockedSpots.push(currentSpot.id);
                localStorage.setItem("wanderlore_unlocked", JSON.stringify(unlockedSpots));
            }

            currentSpot.latitude = data.latitude;
            currentSpot.longitude = data.longitude;
            currentSpot.is_protected = 0;

            renderCoordinatesSection();
            loadSpots();
            updatePassportStats();
            showToast("Lore Decrypted! Exact coordinates revealed.", "award");
        } else {
            const hintBox = document.getElementById("riddle-hint-box");
            const hintText = document.getElementById("riddle-hint-text");
            if (hintBox && hintText) {
                hintBox.classList.remove("hidden");
                hintText.innerText = data.hint || "Review the field notes and history for clues.";
            }
            showToast(data.message || "Incorrect. Ponder the guardian's lore.", "shield-alert");
        }
    } catch (e) {
        console.error("Unlock error", e);
        showToast("Connection failed", "alert-circle");
    }
}

async function upvoteCurrentSpot() {
    if (!currentSpot) return;
    try {
        const res = await fetch(`/api/spots/${currentSpot.id}/upvote`, { method: "POST" });
        const data = await res.json();
        if (data.success) {
            currentSpot.upvotes = data.upvotes;
            document.getElementById("modal-upvotes-count").innerText = data.upvotes;
            loadSpots();
            showToast("Echo recorded for this sanctuary", "heart");
        }
    } catch (e) {
        console.error("Upvote error", e);
    }
}

function renderFieldNotes(notes) {
    const container = document.getElementById("modal-notes-list");
    const countSpan = document.getElementById("modal-notes-count");
    if (!container) return;

    if (countSpan) countSpan.innerText = `${notes.length} Notes`;

    if (notes.length === 0) {
        container.innerHTML = `
            <div class="p-4 rounded-xl bg-obsidian-950 text-slate-500 text-xs font-mono text-center">
                No field notes recorded yet. Be the first explorer to leave trail advice.
            </div>
        `;
        return;
    }

    container.innerHTML = notes.map(note => `
        <div class="bg-obsidian-950 p-3.5 rounded-xl border border-slate-800/80 space-y-1.5">
            <div class="flex items-center justify-between text-xs">
                <div class="flex items-center gap-2">
                    <span class="font-bold text-slate-200 font-mono">${escapeHtml(note.author_name)}</span>
                    <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
                        ${escapeHtml(note.author_badge)}
                    </span>
                    <span class="text-[10px] font-mono text-amberGold-400 bg-amberGold-500/10 px-2 py-0.5 rounded">
                        ${escapeHtml(note.note_type)}
                    </span>
                </div>
                <button onclick="upvoteNote(${note.id})" class="flex items-center gap-1 text-[11px] font-mono text-slate-400 hover:text-amberGold-400">
                    <i data-lucide="thumbs-up" class="w-3 h-3"></i>
                    <span id="note-votes-${note.id}">${note.upvotes}</span>
                </button>
            </div>
            <p class="text-xs text-slate-300 leading-relaxed font-sans">${escapeHtml(note.content)}</p>
        </div>
    `).join("");
}

async function submitFieldNote() {
    if (!currentSpot) return;
    const author = document.getElementById("note-author").value.trim() || currentUserProfile.display_name;
    const badge = document.getElementById("note-badge").value;
    const type = document.getElementById("note-type").value;
    const content = document.getElementById("note-content").value.trim();

    if (!content) {
        showToast("Please enter field note observations", "alert-circle");
        return;
    }

    try {
        const res = await fetch(`/api/spots/${currentSpot.id}/notes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                author_name: author,
                author_badge: badge,
                note_type: type,
                content: content
            })
        });

        const data = await res.json();
        if (data.success) {
            document.getElementById("note-content").value = "";
            userNotesCount += 1;
            localStorage.setItem("wanderlore_notes_count", userNotesCount.toString());
            updatePassportStats();
            openSpotDetail(currentSpot.id);
            loadExpeditions();
            showToast("Field note pinned to sanctuary ledger", "check-circle");
        }
    } catch (e) {
        console.error("Failed to add note", e);
    }
}

async function upvoteNote(noteId) {
    try {
        const res = await fetch(`/api/notes/${noteId}/upvote`, { method: "POST" });
        const data = await res.json();
        if (data.success) {
            const span = document.getElementById(`note-votes-${noteId}`);
            if (span) span.innerText = data.upvotes;
        }
    } catch (e) {
        console.error("Upvote note error", e);
    }
}

function downloadGPX(spotId) {
    if (!currentSpot) return;
    const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WanderLore Anti-Overtourism Network">
  <wpt lat="${currentSpot.latitude}" lon="${currentSpot.longitude}">
    <name>${currentSpot.name}</name>
    <desc>${currentSpot.tagline} - Solitude Score: ${currentSpot.solitude_score}/100. Leave No Trace.</desc>
  </wpt>
</gpx>`;

    const blob = new Blob([gpxContent], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentSpot.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("GPX Waypoint File Downloaded", "download");
}

// ============================================================
// 5. BOOKMARKS & MY JOURNEY
// ============================================================
async function loadBookmarks() {
    try {
        const res = await fetch(`/api/bookmarks?username=${encodeURIComponent(currentUsername)}`);
        const saved = await res.json();
        bookmarkedSpotIds = new Set(saved.map(s => s.id));

        // Update badge count
        const badge = document.getElementById("nav-bookmark-badge");
        if (badge) badge.innerText = saved.length;

        const statSaved = document.getElementById("stat-saved");
        if (statSaved) statSaved.innerText = saved.length;

        const journeyCount = document.getElementById("journey-count");
        if (journeyCount) journeyCount.innerText = saved.length;

        renderJourneyList(saved);
    } catch (e) {
        console.error("Failed to load bookmarks", e);
    }
}

async function toggleBookmark(spotId) {
    try {
        const res = await fetch("/api/bookmarks/toggle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: currentUsername,
                spot_id: spotId
            })
        });
        const data = await res.json();
        if (data.success) {
            if (data.is_bookmarked) {
                bookmarkedSpotIds.add(spotId);
            } else {
                bookmarkedSpotIds.delete(spotId);
            }
            await loadBookmarks();
            renderSpotsList(spots);
            showToast(data.message, data.is_bookmarked ? "bookmark" : "bookmark-minus");
        }
    } catch (e) {
        console.error("Toggle bookmark error", e);
    }
}

async function toggleCurrentSpotBookmark() {
    if (!currentSpot) return;
    await toggleBookmark(currentSpot.id);
    updateModalBookmarkUI();
}

async function saveModalPersonalNote() {
    if (!currentSpot) return;
    const note = document.getElementById("modal-personal-note-input").value.trim();

    try {
        const res = await fetch(`/api/bookmarks/${currentSpot.id}/note`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: currentUsername,
                personal_note: note
            })
        });
        const data = await res.json();
        if (data.success) {
            currentSpot.personal_note = note;
            await loadBookmarks();
            showToast("Expedition note saved to your journey ledger", "check-circle");
        }
    } catch (e) {
        console.error("Save personal note error", e);
    }
}

function renderJourneyList(savedSpots) {
    const container = document.getElementById("journey-list");
    if (!container) return;

    if (savedSpots.length === 0) {
        container.innerHTML = `
            <div class="col-span-full p-12 text-center rounded-2xl bg-obsidian-900 border border-slate-800 space-y-3">
                <i data-lucide="bookmark" class="w-10 h-10 text-slate-600 mx-auto"></i>
                <div class="font-cinzel text-lg text-slate-200">Your Journey Ledger is Empty</div>
                <p class="text-xs text-slate-500 max-w-md mx-auto">
                    Click the bookmark icon on any sanctuary to save it to your expedition list and add private packing notes.
                </p>
                <button onclick="switchView('explore')" class="px-4 py-2 rounded-lg bg-amberGold-500 text-obsidian-950 font-bold text-xs font-mono uppercase">
                    Browse Sanctuaries
                </button>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    container.innerHTML = savedSpots.map(spot => `
        <div class="bg-obsidian-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col justify-between hover:border-amberGold-500/40 transition-all">
            <div>
                <div class="relative h-44 w-full">
                    <img src="${escapeHtml(spot.image_url)}" alt="${escapeHtml(spot.name)}" class="w-full h-full object-cover">
                    <div class="absolute inset-0 bg-gradient-to-t from-obsidian-950 via-transparent to-transparent"></div>
                    <div class="absolute top-3 left-3 px-2 py-0.5 rounded bg-obsidian-950/80 text-[10px] font-mono text-amberGold-400 border border-slate-700">
                        ${escapeHtml(spot.category)}
                    </div>
                    <button onclick="toggleBookmark(${spot.id})" class="absolute top-3 right-3 w-8 h-8 rounded-full bg-obsidian-950/80 border border-slate-700 flex items-center justify-center text-amberGold-400">
                        <i data-lucide="bookmark" class="w-4 h-4 bookmark-active"></i>
                    </button>
                </div>

                <div class="p-4 space-y-2">
                    <h4 class="font-cinzel font-bold text-slate-100 text-base">${escapeHtml(spot.name)}</h4>
                    <div class="text-xs font-mono text-slate-400">${escapeHtml(spot.region)}, ${escapeHtml(spot.country)}</div>
                    
                    <!-- Solitude & Decibel -->
                    <div class="flex items-center gap-3 pt-1 text-xs font-mono">
                        <span class="text-emeraldGlow-400">${spot.solitude_score}% Solitude</span>
                        <span class="text-sky-400">${spot.decibel_level} dB</span>
                    </div>

                    <!-- Personal Note Display -->
                    <div class="bg-obsidian-950 p-3 rounded-lg border border-slate-800 space-y-1 mt-2">
                        <div class="text-[10px] font-mono text-amberGold-400 flex items-center gap-1">
                            <i data-lucide="edit-3" class="w-3 h-3"></i> Private Note:
                        </div>
                        <p class="text-xs text-slate-300 italic">${escapeHtml(spot.personal_note || "No private notes added yet.")}</p>
                    </div>
                </div>
            </div>

            <div class="p-4 pt-0 flex gap-2">
                <button onclick="openSpotDetail(${spot.id})" class="flex-1 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono">
                    Open Lore
                </button>
                <a href="https://www.google.com/maps/search/?api=1&query=${spot.latitude},${spot.longitude}" target="_blank" rel="noopener noreferrer"
                   class="px-3 py-1.5 rounded bg-amberGold-500 hover:bg-amberGold-400 text-obsidian-950 text-xs font-mono font-bold flex items-center gap-1">
                    <i data-lucide="navigation" class="w-3 h-3"></i> Navigate
                </a>
            </div>
        </div>
    `).join("");
    lucide.createIcons();
}

// ============================================================
// 6. THE COMMONS, EXPEDITIONS & DISCUSSIONS
// ============================================================
function switchCommonsTab(tab) {
    const tabExp = document.getElementById("commons-tab-expeditions");
    const tabDisc = document.getElementById("commons-tab-discussions");
    const btnExp = document.getElementById("tab-btn-expeditions");
    const btnDisc = document.getElementById("tab-btn-discussions");

    if (tab === "expeditions") {
        tabExp.classList.remove("hidden");
        tabDisc.classList.add("hidden");
        btnExp.className = "px-4 py-2 rounded-lg bg-obsidian-850 text-amberGold-400 font-bold border border-amberGold-500/30";
        btnDisc.className = "px-4 py-2 rounded-lg bg-transparent text-slate-400 hover:text-slate-200";
    } else {
        tabExp.classList.add("hidden");
        tabDisc.classList.remove("hidden");
        btnDisc.className = "px-4 py-2 rounded-lg bg-obsidian-850 text-amberGold-400 font-bold border border-amberGold-500/30";
        btnExp.className = "px-4 py-2 rounded-lg bg-transparent text-slate-400 hover:text-slate-200";
    }
}

async function loadExpeditions() {
    try {
        const res = await fetch("/api/expeditions");
        expeditions = await res.json();
        renderExpeditions(expeditions);
        renderCommonsNotesFeed();
    } catch (e) {
        console.error("Expeditions error", e);
    }
}

function renderExpeditions(items) {
    const container = document.getElementById("expeditions-list");
    if (!container) return;

    container.innerHTML = items.map(exp => `
        <div class="bg-obsidian-900 border border-slate-800/90 rounded-xl p-5 space-y-3 hover:border-emeraldGlow-500/40 transition-all">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                    <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-emeraldGlow-500/10 text-emeraldGlow-400 border border-emeraldGlow-500/20">
                        Departure: ${escapeHtml(exp.expedition_date)}
                    </span>
                    <h4 class="font-cinzel text-base font-bold text-slate-100 mt-1">${escapeHtml(exp.title)}</h4>
                    <div class="text-xs font-mono text-slate-400 flex items-center gap-1 mt-0.5">
                        <i data-lucide="compass" class="w-3.5 h-3.5 text-amberGold-400"></i>
                        Target: ${escapeHtml(exp.destination_name)} (${escapeHtml(exp.region)})
                    </div>
                </div>
                <div class="flex sm:flex-col items-center sm:items-end justify-between gap-2">
                    <div class="text-xs font-mono text-slate-300">
                        Roster: <span class="text-emeraldGlow-400 font-bold">${exp.current_participants}/${exp.max_participants}</span>
                    </div>
                    <button onclick="joinExpedition(${exp.id})" ${exp.current_participants >= exp.max_participants ? 'disabled' : ''}
                            class="px-3.5 py-1.5 rounded bg-emeraldGlow-500 hover:bg-emeraldGlow-400 disabled:bg-slate-800 disabled:text-slate-600 text-obsidian-950 font-bold text-xs font-mono uppercase transition-colors">
                        ${exp.current_participants >= exp.max_participants ? 'Roster Full' : 'Join Tribe'}
                    </button>
                </div>
            </div>

            <p class="text-xs text-slate-300 leading-relaxed">${escapeHtml(exp.description)}</p>

            <div class="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[11px] font-mono text-slate-400">
                <div class="flex items-center gap-2">
                    <span>Organizer: <strong>${escapeHtml(exp.organizer_name)}</strong></span>
                    <span class="text-amberGold-400">(${escapeHtml(exp.organizer_badge)})</span>
                </div>
                <div class="text-sky-400">${escapeHtml(exp.skill_level)}</div>
            </div>
        </div>
    `).join("");
    lucide.createIcons();
}

function renderCommonsNotesFeed() {
    const feed = document.getElementById("field-notes-feed");
    if (!feed) return;

    feed.innerHTML = `
        <div class="p-3 bg-obsidian-950 border border-slate-800 rounded-xl text-xs space-y-1">
            <div class="flex items-center justify-between font-mono text-[10px]">
                <span class="text-amberGold-400">Purvaj (Astro-Backpacker)</span>
                <span class="text-slate-500">1h ago</span>
            </div>
            <p class="text-slate-300">"Anza-Borrego solstice canyon: sandy ruts at mile 9 cleared. Zero light interference detected at 2:00 AM."</p>
        </div>
        <div class="p-3 bg-obsidian-950 border border-slate-800 rounded-xl text-xs space-y-1">
            <div class="flex items-center justify-between font-mono text-[10px]">
                <span class="text-emeraldGlow-400">Nohwet Bridge Steward</span>
                <span class="text-slate-500">4h ago</span>
            </div>
            <p class="text-slate-300">"Morning mist lifted early. River pool emerald clear. Please remove footwear before ascending the living root bridge."</p>
        </div>
        <div class="p-3 bg-obsidian-950 border border-slate-800 rounded-xl text-xs space-y-1">
            <div class="flex items-center justify-between font-mono text-[10px]">
                <span class="text-sky-400">Mavrovo Guardian</span>
                <span class="text-slate-500">Yesterday</span>
            </div>
            <p class="text-slate-300">"Lake water level dropped 1.4 meters. Dry stone nave is walkable; watch for wet silt near altar."</p>
        </div>
    `;
}

async function joinExpedition(expId) {
    try {
        const res = await fetch(`/api/expeditions/${expId}/join`, { method: "POST" });
        const data = await res.json();
        if (data.success) {
            loadExpeditions();
            showToast("You have joined the expedition tribe! Check rendezvous instructions.", "compass");
        } else {
            showToast(data.error || "Could not join", "alert-circle");
        }
    } catch (e) {
        console.error("Join expedition error", e);
    }
}

// Discussions
async function loadDiscussions() {
    try {
        const res = await fetch("/api/discussions");
        discussions = await res.json();
        renderDiscussions(discussions);
    } catch (e) {
        console.error("Discussions error", e);
    }
}

function renderDiscussions(items) {
    const container = document.getElementById("discussions-list");
    if (!container) return;

    container.innerHTML = items.map(d => `
        <div class="bg-obsidian-900 border border-slate-800 rounded-xl p-5 space-y-3 hover:border-sky-500/40 transition-all flex flex-col justify-between">
            <div class="space-y-2">
                <div class="flex items-center justify-between text-xs font-mono">
                    <span class="px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">${escapeHtml(d.category)}</span>
                    <span class="text-slate-500">${escapeHtml(d.created_at)}</span>
                </div>
                <h4 class="font-cinzel font-bold text-slate-100 text-sm">${escapeHtml(d.title)}</h4>
                <p class="text-xs text-slate-300 leading-relaxed">${escapeHtml(d.content)}</p>
            </div>

            <div class="flex items-center justify-between pt-3 border-t border-slate-800 text-[11px] font-mono text-slate-400">
                <div class="flex items-center gap-2">
                    <span class="text-slate-300 font-bold">${escapeHtml(d.author_name)}</span>
                    <span class="text-amberGold-400">(${escapeHtml(d.author_badge)})</span>
                </div>
                <button onclick="upvoteDiscussion(${d.id})" class="flex items-center gap-1 hover:text-amberGold-400">
                    <i data-lucide="thumbs-up" class="w-3 h-3"></i>
                    <span id="disc-votes-${d.id}">${d.upvotes}</span>
                </button>
            </div>
        </div>
    `).join("");
    lucide.createIcons();
}

async function upvoteDiscussion(discId) {
    try {
        const res = await fetch(`/api/discussions/${discId}/upvote`, { method: "POST" });
        const data = await res.json();
        if (data.success) {
            const span = document.getElementById(`disc-votes-${discId}`);
            if (span) span.innerText = data.upvotes;
        }
    } catch (e) {
        console.error("Upvote discussion error", e);
    }
}

function openPostDiscussionModal() {
    const modal = document.getElementById("discussion-modal");
    if (modal) {
        modal.classList.remove("hidden");
        modal.classList.add("flex");
    }
}

function closePostDiscussionModal() {
    const modal = document.getElementById("discussion-modal");
    if (modal) {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
    }
}

async function handleDiscussionSubmit(e) {
    e.preventDefault();
    const title = document.getElementById("disc-title").value.trim();
    const cat = document.getElementById("disc-category").value;
    const content = document.getElementById("disc-content").value.trim();

    try {
        const res = await fetch("/api/discussions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title: title,
                category: cat,
                content: content,
                author_name: currentUserProfile.display_name,
                author_badge: currentUserProfile.badge
            })
        });

        const data = await res.json();
        if (data.success) {
            closePostDiscussionModal();
            loadDiscussions();
            showToast("Thread published to The Commons", "check-circle");
        }
    } catch (err) {
        console.error("Post discussion failed", err);
    }
}

// ============================================================
// 7. EXPLORER PASSPORT & VAULT
// ============================================================
function updatePassportStats() {
    const solvedSpan = document.getElementById("passport-riddles-solved");
    const notesSpan = document.getElementById("passport-notes-posted");
    if (solvedSpan) solvedSpan.innerText = unlockedSpots.length;
    if (notesSpan) notesSpan.innerText = userNotesCount;
    updateVaultList();
}

function updateVaultList() {
    const container = document.getElementById("unlocked-vault-list");
    if (!container) return;

    const unlocked = spots.filter(s => unlockedSpots.includes(s.id));
    if (unlocked.length === 0) {
        container.innerHTML = `
            <div class="col-span-full p-8 rounded-xl bg-obsidian-900 border border-slate-800 text-center text-slate-500 text-xs font-mono">
                You have not solved any riddle-gated coordinates yet. Visit the Sanctuaries map and test your lore knowledge!
            </div>
        `;
        return;
    }

    container.innerHTML = unlocked.map(s => `
        <div class="bg-obsidian-900 border border-emeraldGlow-500/30 rounded-xl p-4 space-y-2">
            <div class="flex items-center justify-between">
                <span class="text-[10px] font-mono text-emeraldGlow-400 uppercase">DECRYPTED</span>
                <span class="text-xs font-mono text-slate-400">${s.solitude_score}% Solitude</span>
            </div>
            <h4 class="font-cinzel font-bold text-slate-200 text-sm">${escapeHtml(s.name)}</h4>
            <div class="text-xs text-slate-400 font-mono">${escapeHtml(s.region)}, ${escapeHtml(s.country)}</div>
            <div class="text-xs font-mono text-slate-300 pt-1">
                ${s.latitude.toFixed(4)}° N, ${s.longitude.toFixed(4)}° E
            </div>
            <button onclick="openSpotDetail(${s.id})" class="w-full mt-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amberGold-400 text-xs font-mono">
                View Ledger
            </button>
        </div>
    `).join("");
}

// ============================================================
// 8. AMBIENT SOUNDSCAPES (Generative Web Audio API)
// ============================================================
function toggleAmbientAudio() {
    if (!audioIsPlaying) {
        startAmbientAudio();
    } else {
        stopAmbientAudio();
    }
}

function startAmbientAudio() {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const bufferSize = audioCtx.sampleRate * 3;
        const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
            output[i] *= 0.11;
            b6 = white * 0.115926;
        }

        audioNoiseNode = audioCtx.createBufferSource();
        audioNoiseNode.buffer = noiseBuffer;
        audioNoiseNode.loop = true;

        audioFilterNode = audioCtx.createBiquadFilter();
        audioFilterNode.type = "lowpass";
        audioFilterNode.frequency.value = 320;

        audioGain = audioCtx.createGain();
        audioGain.gain.setValueAtTime(0.01, audioCtx.currentTime);
        audioGain.gain.exponentialRampToValueAtTime(0.22, audioCtx.currentTime + 2);

        audioLfo = audioCtx.createOscillator();
        const lfoGain = audioCtx.createGain();
        audioLfo.frequency.value = 0.15;
        lfoGain.gain.value = 140;

        audioLfo.connect(lfoGain);
        lfoGain.connect(audioFilterNode.frequency);

        audioNoiseNode.connect(audioFilterNode);
        audioFilterNode.connect(audioGain);
        audioGain.connect(audioCtx.destination);

        audioNoiseNode.start();
        audioLfo.start();

        audioIsPlaying = true;
        updateAudioButtonUI(true);
        showToast("Soundscape active: Whispering Mountain Wind (Web Audio)", "volume-2");
    } catch (e) {
        console.error("Web Audio initialization failed", e);
    }
}

function stopAmbientAudio() {
    if (audioGain && audioCtx) {
        audioGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1);
        setTimeout(() => {
            if (audioNoiseNode) {
                audioNoiseNode.stop();
                audioNoiseNode.disconnect();
            }
            if (audioLfo) {
                audioLfo.stop();
                audioLfo.disconnect();
            }
            audioIsPlaying = false;
            updateAudioButtonUI(false);
        }, 1000);
    } else {
        audioIsPlaying = false;
        updateAudioButtonUI(false);
    }
}

function updateAudioButtonUI(playing) {
    const icon = document.getElementById("audio-icon");
    const status = document.getElementById("audio-status");
    if (!icon || !status) return;

    if (playing) {
        icon.setAttribute("data-lucide", "volume-2");
        icon.classList.add("text-amberGold-400");
        icon.classList.remove("text-slate-400");
        status.innerText = "Wind Ambience";
    } else {
        icon.setAttribute("data-lucide", "volume-x");
        icon.classList.remove("text-amberGold-400");
        icon.classList.add("text-slate-400");
        status.innerText = "Silence";
    }
    lucide.createIcons();
}

// ============================================================
// 9. EVENT LISTENERS & NAVIGATION
// ============================================================
function setupEventListeners() {
    // Category Pills
    const catContainer = document.getElementById("category-filters");
    if (catContainer) {
        catContainer.addEventListener("click", (e) => {
            const btn = e.target.closest(".cat-pill");
            if (!btn) return;

            document.querySelectorAll(".cat-pill").forEach(p => p.classList.remove("active"));
            btn.classList.add("active");
            activeCategory = btn.getAttribute("data-category");
            loadSpots();
        });
    }

    // Solitude Slider
    const slider = document.getElementById("solitude-slider");
    const sliderVal = document.getElementById("solitude-val");
    if (slider) {
        slider.addEventListener("input", (e) => {
            minSolitude = parseInt(e.target.value);
            if (sliderVal) sliderVal.innerText = `${minSolitude}%`;
            loadSpots();
        });
    }

    // Search Input with Debounce
    const searchInput = document.getElementById("search-input");
    if (searchInput) {
        let timer = null;
        searchInput.addEventListener("input", (e) => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                searchQuery = e.target.value.trim();
                loadSpots();
            }, 300);
        });
    }
}

function applyCategoryFilter(catName) {
    activeCategory = catName;
    document.querySelectorAll(".cat-pill").forEach(p => {
        if (p.getAttribute("data-category") === catName) {
            p.classList.add("active");
        } else {
            p.classList.remove("active");
        }
    });
    loadSpots();
    switchView("explore");
}

function resetFilters() {
    activeCategory = "All";
    minSolitude = 0;
    searchQuery = "";

    const slider = document.getElementById("solitude-slider");
    const sliderVal = document.getElementById("solitude-val");
    const searchInput = document.getElementById("search-input");

    if (slider) slider.value = 0;
    if (sliderVal) sliderVal.innerText = "0%";
    if (searchInput) searchInput.value = "";

    document.querySelectorAll(".cat-pill").forEach(p => {
        if (p.getAttribute("data-category") === "All") p.classList.add("active");
        else p.classList.remove("active");
    });

    loadSpots();
}

function switchView(viewName) {
    const views = ["explore", "commons", "journey", "passport"];
    views.forEach(v => {
        const el = document.getElementById(`view-${v}`);
        const btn = document.getElementById(`nav-${v}`);
        if (v === viewName) {
            if (el) el.classList.remove("hidden");
            if (btn) btn.classList.add("active");
        } else {
            if (el) el.classList.add("hidden");
            if (btn) btn.classList.remove("active");
        }
    });

    if (viewName === "explore" && map) {
        setTimeout(() => map.invalidateSize(), 200);
    }
    if (viewName === "journey") {
        loadBookmarks();
    }
    if (viewName === "passport") {
        updatePassportStats();
    }
}

function setDisplayMode(mode) {
    const mapWrapper = document.getElementById("map-wrapper");
    const gridWrapper = document.getElementById("grid-wrapper");
    const toggleSplit = document.getElementById("toggle-split");
    const toggleMap = document.getElementById("toggle-map");
    const toggleGrid = document.getElementById("toggle-grid");

    [toggleSplit, toggleMap, toggleGrid].forEach(b => {
        b.className = "px-3 py-1.5 rounded-md font-medium text-slate-400 hover:text-slate-200";
    });

    if (mode === "split") {
        mapWrapper.className = "lg:col-span-7 flex flex-col rounded-2xl overflow-hidden border border-slate-800 bg-obsidian-900 shadow-xl relative";
        gridWrapper.className = "lg:col-span-5 flex flex-col space-y-4";
        mapWrapper.classList.remove("hidden");
        gridWrapper.classList.remove("hidden");
        toggleSplit.className = "px-3 py-1.5 rounded-md font-medium text-amberGold-400 bg-obsidian-850";
    } else if (mode === "map") {
        mapWrapper.className = "col-span-12 flex flex-col rounded-2xl overflow-hidden border border-slate-800 bg-obsidian-900 shadow-xl relative min-h-[600px]";
        gridWrapper.classList.add("hidden");
        mapWrapper.classList.remove("hidden");
        toggleMap.className = "px-3 py-1.5 rounded-md font-medium text-amberGold-400 bg-obsidian-850";
    } else if (mode === "grid") {
        gridWrapper.className = "col-span-12 flex flex-col space-y-4";
        mapWrapper.classList.add("hidden");
        gridWrapper.classList.remove("hidden");
        toggleGrid.className = "px-3 py-1.5 rounded-md font-medium text-amberGold-400 bg-obsidian-850";
    }

    if (map) {
        setTimeout(() => map.invalidateSize(), 250);
    }
}

// Modal Form Openers
function openSubmitModal() {
    const modal = document.getElementById("submit-spot-modal");
    if (modal) {
        modal.classList.remove("hidden");
        modal.classList.add("flex");
    }
}
function closeSubmitModal() {
    const modal = document.getElementById("submit-spot-modal");
    if (modal) {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
    }
}
function toggleRiddleInputs() {
    const check = document.getElementById("sub-protect");
    const fields = document.getElementById("riddle-fields");
    if (check && fields) {
        fields.classList.toggle("hidden", !check.checked);
    }
}
async function handleSpotSubmit(e) {
    e.preventDefault();
    const name = document.getElementById("sub-name").value.trim();
    const category = document.getElementById("sub-category").value;
    const region = document.getElementById("sub-region").value.trim();
    const country = document.getElementById("sub-country").value.trim();
    const tagline = document.getElementById("sub-tagline").value.trim() || "An unblemished haven of stillness";
    const lat = parseFloat(document.getElementById("sub-lat").value) || 45.0;
    const lng = parseFloat(document.getElementById("sub-lng").value) || 10.0;
    const solitude = parseInt(document.getElementById("sub-solitude").value);
    const decibel = parseInt(document.getElementById("sub-decibel").value);
    const signal = document.getElementById("sub-signal").value;
    const lore = document.getElementById("sub-lore").value.trim();
    const lnt = document.getElementById("sub-lnt").value.trim();
    const isProtected = document.getElementById("sub-protect").checked;
    const riddleQ = document.getElementById("sub-riddle-q").value.trim();
    const riddleA = document.getElementById("sub-riddle-a").value.trim();
    const riddleH = document.getElementById("sub-riddle-h").value.trim();

    try {
        const res = await fetch("/api/spots", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: name,
                tagline: tagline,
                region: region,
                country: country,
                category: category,
                latitude: lat,
                longitude: lng,
                solitude_score: solitude,
                decibel_level: decibel,
                cell_signal: signal,
                lore: lore,
                leave_no_trace_notes: lnt,
                is_protected: isProtected,
                riddle_question: riddleQ,
                riddle_answer: riddleA,
                riddle_hint: riddleH
            })
        });

        const data = await res.json();
        if (data.success) {
            closeSubmitModal();
            loadSpots();
            fetchStats();
            showToast("Sanctuary registered under Guardian Ledger", "shield-check");
        }
    } catch (err) {
        console.error("Submit spot error", err);
    }
}

function openCreateExpeditionModal() {
    const modal = document.getElementById("create-expedition-modal");
    if (modal) {
        const orgInput = document.getElementById("exp-organizer");
        if (orgInput && currentUserProfile) orgInput.value = currentUserProfile.display_name;
        modal.classList.remove("hidden");
        modal.classList.add("flex");
    }
}
function closeCreateExpeditionModal() {
    const modal = document.getElementById("create-expedition-modal");
    if (modal) {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
    }
}
async function handleExpeditionSubmit(e) {
    e.preventDefault();
    const title = document.getElementById("exp-title").value.trim();
    const dest = document.getElementById("exp-dest").value.trim();
    const date = document.getElementById("exp-date").value.trim();
    const organizer = document.getElementById("exp-organizer").value.trim();
    const skill = document.getElementById("exp-skill").value;
    const max = parseInt(document.getElementById("exp-max").value);
    const desc = document.getElementById("exp-desc").value.trim();

    try {
        const res = await fetch("/api/expeditions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                title: title,
                destination_name: dest,
                region: "Explorer Route",
                organizer_name: organizer,
                organizer_badge: currentUserProfile ? currentUserProfile.badge : "Tribe Leader",
                expedition_date: date,
                skill_level: skill,
                max_participants: max,
                description: desc
            })
        });

        const data = await res.json();
        if (data.success) {
            closeCreateExpeditionModal();
            loadExpeditions();
            fetchStats();
            showToast("New Expedition posted to The Commons", "compass");
        }
    } catch (err) {
        console.error("Create expedition failed", err);
    }
}

async function fetchStats() {
    try {
        const res = await fetch("/api/stats");
        const stats = await res.json();
        const statS = document.getElementById("stat-sanctuaries");
        const statSol = document.getElementById("stat-solitude");
        const statDec = document.getElementById("stat-decibel");
        const statSaved = document.getElementById("stat-saved");

        if (statS) statS.innerText = stats.total_sanctuaries;
        if (statSol) statSol.innerText = `${stats.avg_solitude_score}%`;
        if (statDec) statDec.innerText = `${stats.avg_decibel_level} dB`;
        if (statSaved) statSaved.innerText = stats.saved_journeys || 0;
    } catch (e) {
        console.error("Failed to load stats", e);
    }
}

// Toast
let toastTimer = null;
function showToast(message, iconName = "info") {
    const toast = document.getElementById("toast");
    const msg = document.getElementById("toast-msg");
    const icon = document.getElementById("toast-icon");
    if (!toast || !msg) return;

    msg.innerText = message;
    if (icon) {
        icon.setAttribute("data-lucide", iconName);
        lucide.createIcons();
    }

    toast.classList.add("toast-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove("toast-visible");
    }, 4000);
}

function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}
