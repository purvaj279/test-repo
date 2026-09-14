/**
 * WANDERLORE - Production Luxury Controller & Dual-Engine Cartography
 */

// Application State
let spots = [];
let expeditions = [];
let discussions = [];
let userTrips = [];
let userBookings = [];
let activeCategory = "All";
let minSolitude = 70;
let searchQuery = "";
let currentSpot = null;
let currentTrip = null;
let currentUser = null;
let bookmarkedSpotIds = new Set();
let unlockedSpots = JSON.parse(localStorage.getItem("wanderlore_unlocked") || "[]");
let userNotesCount = parseInt(localStorage.getItem("wanderlore_notes_count") || "0");

// Maps Engine State (Leaflet + Google Maps Resilient Fallback)
let mainMap = null;
let mainMarkersLayer = null;
let tripMap = null;
let tripRouteLayer = null;
let gmapsLoaded = false;
let gmapsApiKey = "";

// Ambient Audio Engine (Web Audio API)
let audioCtx = null;
let audioIsPlaying = false;
let audioGain = null;
let audioNoiseNode = null;
let audioFilterNode = null;
let audioLfo = null;

// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener("DOMContentLoaded", async () => {
    setupEventListeners();
    await checkMapEngineConfig();
    initMainMap();
    await checkAuthSession();
    await fetchStats();
    await loadSpots();
    await loadExpeditions();
    await loadDiscussions();
    lucide.createIcons();
});

// ============================================================
// 1. GOOGLE MAPS & DUAL-ENGINE FALLBACK
// ============================================================
async function checkMapEngineConfig() {
    try {
        const res = await fetch("/api/config");
        const config = await res.json();
        gmapsApiKey = localStorage.getItem("wanderlore_gmaps_key") || config.google_maps_api_key;

        const badge = document.getElementById("map-engine-label");
        const inputKey = document.getElementById("input-gmaps-key");
        if (inputKey && gmapsApiKey) inputKey.value = gmapsApiKey;

        if (gmapsApiKey && gmapsApiKey.startsWith("AIzaSy")) {
            loadGoogleMapsScript(gmapsApiKey);
            if (badge) badge.innerText = "Google Maps JS Ready";
        } else {
            if (badge) badge.innerText = "CartoDB Dark Matter Active";
        }
    } catch (e) {
        console.warn("Config check fallback:", e);
    }
}

function loadGoogleMapsScript(apiKey) {
    if (window.google && window.google.maps) {
        gmapsLoaded = true;
        return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
        gmapsLoaded = true;
        const badge = document.getElementById("map-engine-label");
        if (badge) badge.innerText = "Google Maps Active";
        showToast("Google Maps JavaScript API Connected", "map");
    };
    script.onerror = () => {
        console.warn("Google Maps script failed to load. Gracefully using high-contrast CartoDB/Leaflet engine.");
        const badge = document.getElementById("map-engine-label");
        if (badge) badge.innerText = "CartoDB Resilient Mode";
    };
    document.head.appendChild(script);
}

function openGmapsConfigModal() {
    const modal = document.getElementById("gmaps-modal");
    if (modal) {
        modal.classList.remove("hidden");
        modal.classList.add("flex");
    }
}

function closeGmapsConfigModal() {
    const modal = document.getElementById("gmaps-modal");
    if (modal) {
        modal.classList.add("hidden");
        modal.classList.remove("flex");
    }
}

function handleSaveGmapsKey(e) {
    e.preventDefault();
    const key = document.getElementById("input-gmaps-key").value.trim();
    if (key) {
        localStorage.setItem("wanderlore_gmaps_key", key);
        loadGoogleMapsScript(key);
        showToast("Key saved. Testing Google Maps connection...", "check-circle");
    } else {
        localStorage.removeItem("wanderlore_gmaps_key");
        showToast("Reset to CartoDB High-Res engine", "info");
    }
    closeGmapsConfigModal();
}

// ============================================================
// 2. MAIN MAP ENGINE (Leaflet + Custom Luxury Styling)
// ============================================================
function initMainMap() {
    mainMap = L.map('sanctuary-map', {
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
    }).addTo(mainMap);

    mainMarkersLayer = L.layerGroup().addTo(mainMap);
}

function renderMainMapMarkers(spotsToRender) {
    if (!mainMap || !mainMarkersLayer) return;
    mainMarkersLayer.clearLayers();

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
            <div class="space-y-2 min-w-[220px] p-1">
                <div class="flex items-center justify-between text-[10px] font-mono">
                    <span class="text-sky-400 font-semibold uppercase tracking-wider">${escapeHtml(spot.category)}</span>
                    <span class="text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">${spot.match_percentage}% Match</span>
                </div>
                <div class="font-display font-bold text-white text-sm tracking-tight">${escapeHtml(spot.name)}</div>
                <div class="text-xs text-slate-400 font-mono">${escapeHtml(spot.region)}, ${escapeHtml(spot.country)}</div>
                <div class="flex items-center gap-3 pt-1 text-[11px] font-mono">
                    <span class="text-emerald-400 font-semibold">Solitude: ${spot.solitude_score}%</span>
                    <span class="text-sky-400">${spot.decibel_level} dB</span>
                </div>
                <div class="flex gap-2 mt-2 pt-1 border-t border-slate-800">
                    <button onclick="openSpotDetail(${spot.id})" class="flex-1 py-1.5 rounded-md bg-sky-500 hover:bg-sky-400 text-[#0B0F19] font-mono font-bold text-[10px] uppercase transition-colors">
                        Inspect
                    </button>
                    <button onclick="openBookingModalForSpot(${spot.id})" class="px-2.5 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-[#0B0F19] font-mono font-bold text-[10px] uppercase transition-colors">
                        Permit
                    </button>
                </div>
            </div>
        `;

        marker.bindPopup(popupContent);
        mainMarkersLayer.addLayer(marker);
    });

    if (bounds.length > 0 && mainMap) {
        mainMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 8 });
    }
}

// ============================================================
// 3. USER AUTHENTICATION & SESSION MANAGEMENT
// ============================================================
async function checkAuthSession() {
    try {
        const res = await fetch("/api/auth/me");
        const data = await res.json();
        if (data.authenticated && data.user) {
            currentUser = data.user;
            setAuthState(true);
        } else {
            currentUser = null;
            setAuthState(false);
        }
    } catch (e) {
        console.error("Auth check failed", e);
        setAuthState(false);
    }
}

function setAuthState(isLoggedIn) {
    const loggedOutEl = document.getElementById("auth-logged-out");
    const loggedInEl = document.getElementById("auth-logged-in");

    if (isLoggedIn && currentUser) {
        if (loggedOutEl) loggedOutEl.classList.add("hidden");
        if (loggedInEl) loggedInEl.classList.remove("hidden");

        // Header User info
        const nameEl = document.getElementById("header-user-name");
        const roleEl = document.getElementById("header-user-role");
        const avatarEl = document.getElementById("header-user-avatar");
        const dropEmail = document.getElementById("dropdown-user-email");
        const dropTitle = document.getElementById("dropdown-user-title");

        if (nameEl) nameEl.innerText = currentUser.display_name;
        if (roleEl) roleEl.innerText = currentUser.role.toUpperCase();
        if (avatarEl) avatarEl.src = currentUser.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.email}`;
        if (dropEmail) dropEmail.innerText = currentUser.email;
        if (dropTitle) dropTitle.innerText = currentUser.title;

        // Dashboard info
        const dName = document.getElementById("dashboard-display-name");
        const dTitle = document.getElementById("dashboard-title");
        const dAvatar = document.getElementById("dashboard-avatar");
        const accName = document.getElementById("acc-name");
        const accTitle = document.getElementById("acc-title");
        const accBio = document.getElementById("acc-bio");
        const accAvatar = document.getElementById("acc-avatar");

        if (dName) dName.innerText = currentUser.display_name;
        if (dTitle) dTitle.innerText = currentUser.title;
        if (dAvatar) dAvatar.src = currentUser.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${currentUser.email}`;
        if (accName) accName.value = currentUser.display_name;
        if (accTitle) accTitle.value = currentUser.title;
        if (accBio) accBio.value = currentUser.bio || "";
        if (accAvatar) accAvatar.value = currentUser.avatar_url || "";

        // Welcome banner
        const bName = document.getElementById("banner-username");
        const bTitle = document.getElementById("banner-user-title");
        if (bName) bName.innerText = currentUser.display_name;
        if (bTitle) bTitle.innerText = currentUser.title;

        loadUserTrips();
        loadUserBookings();
    } else {
        if (loggedOutEl) loggedOutEl.classList.remove("hidden");
        if (loggedInEl) loggedInEl.classList.add("hidden");
    }
}

function toggleUserMenu() {
    const menu = document.getElementById("user-menu");
    if (menu) menu.classList.toggle("hidden");
}

function openLoginModal() {
    document.getElementById("login-modal").classList.remove("hidden");
    document.getElementById("login-modal").classList.add("flex");
}
function closeLoginModal() {
    document.getElementById("login-modal").classList.add("hidden");
    document.getElementById("login-modal").classList.remove("flex");
}

function openRegisterModal() {
    document.getElementById("register-modal").classList.remove("hidden");
    document.getElementById("register-modal").classList.add("flex");
}
function closeRegisterModal() {
    document.getElementById("register-modal").classList.add("hidden");
    document.getElementById("register-modal").classList.remove("flex");
}

function openForgotModal() {
    document.getElementById("forgot-modal").classList.remove("hidden");
    document.getElementById("forgot-modal").classList.add("flex");
    document.getElementById("forgot-step1-form").classList.remove("hidden");
    document.getElementById("forgot-step2-form").classList.add("hidden");
}
function closeForgotModal() {
    document.getElementById("forgot-modal").classList.add("hidden");
    document.getElementById("forgot-modal").classList.remove("flex");
}

function fillDemoLogin() {
    document.getElementById("login-email").value = "purvaj@wanderlore.com";
    document.getElementById("login-password").value = "password123";
    showToast("Demo credentials filled. Click Sign In.", "key");
}

async function handleLoginSubmit(e) {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value.trim();

    try {
        const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (data.success) {
            currentUser = data.user;
            setAuthState(true);
            closeLoginModal();
            showToast(data.message, "check-circle");
            loadSpots();
        } else {
            showToast(data.error || "Login failed", "alert-circle");
        }
    } catch (err) {
        console.error("Login error", err);
        showToast("Connection error during login", "alert-circle");
    }
}

async function handleRegisterSubmit(e) {
    e.preventDefault();
    const name = document.getElementById("reg-name").value.trim();
    const email = document.getElementById("reg-email").value.trim();
    const password = document.getElementById("reg-password").value.trim();

    try {
        const res = await fetch("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ display_name: name, email, password })
        });
        const data = await res.json();
        if (data.success) {
            currentUser = data.user;
            setAuthState(true);
            closeRegisterModal();
            showToast("Passport created! Welcome to WanderLore.", "award");
            loadSpots();
        } else {
            showToast(data.error || "Registration failed", "alert-circle");
        }
    } catch (err) {
        console.error("Registration error", err);
    }
}

async function handleLogout() {
    toggleUserMenu();
    try {
        await fetch("/api/auth/logout", { method: "POST" });
        currentUser = null;
        setAuthState(false);
        showToast("Signed out successfully", "log-out");
        switchView("explore");
    } catch (e) {
        console.error("Logout error", e);
    }
}

async function handleForgotStep1(e) {
    e.preventDefault();
    const email = document.getElementById("forgot-email").value.trim();
    try {
        const res = await fetch("/api/auth/forgot-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById("forgot-step1-form").classList.add("hidden");
            document.getElementById("forgot-step2-form").classList.remove("hidden");
            document.getElementById("demo-token-display").innerText = data.demo_reset_token;
            document.getElementById("reset-token-input").value = data.demo_reset_token;
            showToast("Reset token generated!", "key");
        } else {
            showToast(data.error || "Failed to find account", "alert-circle");
        }
    } catch (err) {
        console.error("Forgot password error", err);
    }
}

async function handleForgotStep2(e) {
    e.preventDefault();
    const token = document.getElementById("reset-token-input").value.trim();
    const new_password = document.getElementById("reset-new-password").value.trim();

    try {
        const res = await fetch("/api/auth/reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, new_password })
        });
        const data = await res.json();
        if (data.success) {
            closeForgotModal();
            openLoginModal();
            showToast(data.message, "check-circle");
        } else {
            showToast(data.error || "Reset failed", "alert-circle");
        }
    } catch (err) {
        console.error("Reset error", err);
    }
}

async function handleAccountUpdate(e) {
    e.preventDefault();
    const name = document.getElementById("acc-name").value.trim();
    const title = document.getElementById("acc-title").value.trim();
    const bio = document.getElementById("acc-bio").value.trim();
    const avatar = document.getElementById("acc-avatar").value.trim();

    try {
        const res = await fetch("/api/auth/profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ display_name: name, title, bio, avatar_url: avatar })
        });
        const data = await res.json();
        if (data.success) {
            currentUser = data.user;
            setAuthState(true);
            showToast("Account details updated", "check-circle");
        }
    } catch (err) {
        console.error("Account update error", err);
    }
}

// ============================================================
// 4. ITINERARIES & DYNAMIC WAYPOINT ROUTE PLANNER
// ============================================================
async function loadUserTrips() {
    try {
        const res = await fetch("/api/trips");
        userTrips = await res.json();
        renderTripsList(userTrips);

        const badge = document.getElementById("nav-trip-count-badge");
        if (badge) badge.innerText = userTrips.length;

        if (userTrips.length > 0 && !currentTrip) {
            selectTrip(userTrips[0].id);
        }
    } catch (e) {
        console.error("Failed to load user trips", e);
    }
}

function renderTripsList(trips) {
    const container = document.getElementById("trips-list");
    if (!container) return;

    if (trips.length === 0) {
        container.innerHTML = `
            <div class="p-6 text-center rounded-xl bg-[#0F172A] border border-slate-800 space-y-2">
                <i data-lucide="map" class="w-6 h-6 text-slate-600 mx-auto"></i>
                <div class="font-display font-medium text-slate-300 text-sm">No Itineraries Created</div>
                <button onclick="openCreateTripModal()" class="text-xs font-mono text-sky-400 underline">Create your first route</button>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    container.innerHTML = trips.map(t => {
        const isSelected = currentTrip && currentTrip.id === t.id;
        return `
            <div onclick="selectTrip(${t.id})" class="p-4 rounded-xl border ${isSelected ? 'trip-card-active' : 'border-slate-800 bg-[#0F172A]'} hover:border-slate-700 cursor-pointer transition-all space-y-2">
                <div class="flex items-start justify-between gap-2">
                    <div>
                        <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 font-medium">${escapeHtml(t.status)}</span>
                        <h4 class="font-display font-bold text-white text-sm mt-1 tracking-tight">${escapeHtml(t.title)}</h4>
                    </div>
                    <span class="text-xs font-mono text-slate-400">${t.waypoints_count || 0} Waypoints</span>
                </div>
                <div class="text-xs font-mono text-slate-400 flex items-center gap-1.5">
                    <i data-lucide="map-pin" class="w-3.5 h-3.5 text-sky-400"></i>
                    <span>${escapeHtml(t.destination)}</span>
                </div>
                <div class="flex items-center justify-between text-[11px] font-mono text-slate-500 pt-1.5 border-t border-slate-800/80">
                    <span>${escapeHtml(t.start_date)} - ${escapeHtml(t.end_date)}</span>
                    <button onclick="event.stopPropagation(); deleteTrip(${t.id})" class="text-slate-500 hover:text-red-400 transition-colors" title="Delete Itinerary">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                </div>
            </div>
        `;
    }).join("");
    lucide.createIcons();
}

async function selectTrip(tripId) {
    try {
        const res = await fetch(`/api/trips/${tripId}`);
        currentTrip = await res.json();
        renderTripsList(userTrips);

        // Update active trip view
        document.getElementById("active-trip-title").innerText = currentTrip.title;
        document.getElementById("active-trip-meta").innerText = `${currentTrip.destination} • ${currentTrip.start_date} to ${currentTrip.end_date}`;
        document.getElementById("btn-add-waypoint").classList.remove("hidden");

        renderTripWaypoints(currentTrip.waypoints || []);
        renderTripRouteOnMap(currentTrip.waypoints || []);
    } catch (e) {
        console.error("Error selecting trip", e);
    }
}

function renderTripWaypoints(waypoints) {
    const container = document.getElementById("trip-waypoints-list");
    if (!container) return;

    if (waypoints.length === 0) {
        container.innerHTML = `
            <div class="p-4 rounded-lg bg-obsidian-950 text-slate-500 text-xs font-mono text-center">
                No waypoints added yet. Click "+ Add Waypoint" to plot stops on your expedition route.
            </div>
        `;
        return;
    }

    container.innerHTML = waypoints.map((w, index) => `
        <div class="p-2.5 rounded-lg bg-obsidian-950 border border-slate-800/80 flex items-center justify-between gap-3 text-xs font-mono">
            <div class="flex items-center gap-2.5">
                <div class="w-6 h-6 rounded-full bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center justify-center text-xs font-bold shrink-0">
                    ${index + 1}
                </div>
                <div>
                    <div class="text-slate-200 font-bold">${escapeHtml(w.title)}</div>
                    <div class="text-[10px] text-slate-500">Day ${w.day_number} • ${w.latitude.toFixed(3)}° N, ${w.longitude.toFixed(3)}° E</div>
                </div>
            </div>
            <button onclick="deleteWaypoint(${currentTrip.id}, ${w.id})" class="text-slate-600 hover:text-red-400" title="Remove Waypoint">
                <i data-lucide="x" class="w-3.5 h-3.5"></i>
            </button>
        </div>
    `).join("");
    lucide.createIcons();
}

// Draw Route Polyline on Trip Map
function renderTripRouteOnMap(waypoints) {
    const mapEl = document.getElementById("trip-route-map");
    if (!mapEl) return;

    if (!tripMap) {
        tripMap = L.map('trip-route-map', {
            center: [33.25, -116.3],
            zoom: 9,
            zoomControl: false
        });
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; CARTO',
            subdomains: 'abcd',
            maxZoom: 18
        }).addTo(tripMap);
        tripRouteLayer = L.layerGroup().addTo(tripMap);
    }

    tripRouteLayer.clearLayers();
    if (waypoints.length === 0) return;

    const latlngs = [];
    waypoints.forEach((w, idx) => {
        latlngs.push([w.latitude, w.longitude]);

        // Numbered custom waypoint marker
        const pinIcon = L.divIcon({
            className: 'custom-waypoint',
            html: `<div class="waypoint-pin">${idx + 1}</div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });

        const marker = L.marker([w.latitude, w.longitude], { icon: pinIcon });
        marker.bindPopup(`<strong>Stop ${idx + 1}: ${escapeHtml(w.title)}</strong><br>Day ${w.day_number}`);
        tripRouteLayer.addLayer(marker);
    });

    // Draw connecting polyline
    if (latlngs.length >= 2) {
        const routeLine = L.polyline(latlngs, {
            color: '#38bdf8',
            weight: 3,
            opacity: 0.85,
            dashArray: '6, 6'
        });
        tripRouteLayer.addLayer(routeLine);
    }

    tripMap.fitBounds(latlngs, { padding: [30, 30], maxZoom: 11 });
    setTimeout(() => tripMap.invalidateSize(), 200);
}

function openCreateTripModal() {
    document.getElementById("create-trip-modal").classList.remove("hidden");
    document.getElementById("create-trip-modal").classList.add("flex");
}
function closeCreateTripModal() {
    document.getElementById("create-trip-modal").classList.add("hidden");
    document.getElementById("create-trip-modal").classList.remove("flex");
}

async function handleTripSubmit(e) {
    e.preventDefault();
    const title = document.getElementById("trip-title").value.trim();
    const dest = document.getElementById("trip-destination").value.trim();
    const start = document.getElementById("trip-start").value.trim();
    const end = document.getElementById("trip-end").value.trim();
    const notes = document.getElementById("trip-notes").value.trim();

    try {
        const res = await fetch("/api/trips", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, destination: dest, start_date: start, end_date: end, notes })
        });
        const data = await res.json();
        if (data.success) {
            closeCreateTripModal();
            await loadUserTrips();
            selectTrip(data.id);
            showToast("New expedition itinerary created!", "check-circle");
        }
    } catch (err) {
        console.error("Create trip error", err);
    }
}

async function deleteTrip(tripId) {
    if (!confirm("Are you sure you want to delete this itinerary?")) return;
    try {
        await fetch(`/api/trips/${tripId}`, { method: "DELETE" });
        currentTrip = null;
        await loadUserTrips();
        showToast("Itinerary deleted", "trash");
    } catch (e) {
        console.error("Delete trip error", e);
    }
}

function openAddWaypointModal() {
    document.getElementById("add-waypoint-modal").classList.remove("hidden");
    document.getElementById("add-waypoint-modal").classList.add("flex");
}
function closeAddWaypointModal() {
    document.getElementById("add-waypoint-modal").classList.add("hidden");
    document.getElementById("add-waypoint-modal").classList.remove("flex");
}

function presetWaypointCoords(val) {
    if (!val) return;
    const [lat, lng] = val.split(",");
    document.getElementById("wp-lat").value = lat;
    document.getElementById("wp-lng").value = lng;
}

async function handleWaypointSubmit(e) {
    e.preventDefault();
    if (!currentTrip) return;

    const title = document.getElementById("wp-title").value.trim();
    const lat = parseFloat(document.getElementById("wp-lat").value);
    const lng = parseFloat(document.getElementById("wp-lng").value);
    const day = parseInt(document.getElementById("wp-day").value);
    const notes = document.getElementById("wp-notes").value.trim();

    try {
        const res = await fetch(`/api/trips/${currentTrip.id}/waypoints`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, latitude: lat, longitude: lng, day_number: day, notes })
        });
        const data = await res.json();
        if (data.success) {
            closeAddWaypointModal();
            selectTrip(currentTrip.id);
            showToast("Waypoint added to route", "map-pin");
        }
    } catch (err) {
        console.error("Add waypoint error", err);
    }
}

async function deleteWaypoint(tripId, waypointId) {
    try {
        await fetch(`/api/trips/${tripId}/waypoints/${waypointId}`, { method: "DELETE" });
        selectTrip(tripId);
        showToast("Waypoint removed", "trash");
    } catch (e) {
        console.error("Delete waypoint error", e);
    }
}

// ============================================================
// 5. RESERVATIONS & BOOKINGS
// ============================================================
async function loadUserBookings() {
    try {
        const res = await fetch("/api/bookings");
        userBookings = await res.json();
        renderBookingsList(userBookings);

        const statPermits = document.getElementById("stat-permits");
        if (statPermits) statPermits.innerText = userBookings.filter(b => b.status === 'Confirmed').length;
    } catch (e) {
        console.error("Failed to load bookings", e);
    }
}

function renderBookingsList(bookings) {
    const container = document.getElementById("bookings-list");
    if (!container) return;

    if (bookings.length === 0) {
        container.innerHTML = `
            <div class="col-span-full p-8 text-center rounded-xl bg-[#0F172A] border border-slate-800 space-y-2">
                <i data-lucide="ticket" class="w-8 h-8 text-slate-600 mx-auto"></i>
                <div class="font-display font-semibold text-slate-300">No Active Sanctuary Permits</div>
                <p class="text-xs text-slate-500">Reserve an eco-permit from any sanctuary detail card to explore with verified guardian authorization.</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    container.innerHTML = bookings.map(b => `
        <div class="bg-[#0F172A] border border-slate-800 rounded-xl p-5 space-y-3 flex flex-col justify-between">
            <div class="space-y-2">
                <div class="flex items-center justify-between text-xs font-mono">
                    <span class="text-sky-400 font-bold tracking-wider">PERMIT: ${escapeHtml(b.booking_reference)}</span>
                    <span class="px-2 py-0.5 rounded text-[10px] font-medium ${b.status === 'Confirmed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/10 text-red-400'}">
                        ${escapeHtml(b.status)}
                    </span>
                </div>
                <h4 class="font-display font-bold text-white text-sm tracking-tight">${escapeHtml(b.spot_name || b.expedition_title || "Sanctuary Access")}</h4>
                <div class="text-xs font-mono text-slate-400">${escapeHtml(b.booking_type)}</div>
                <div class="flex items-center justify-between text-xs font-mono text-slate-300 pt-1">
                    <span>Date: <strong>${escapeHtml(b.travel_date)}</strong></span>
                    <span>Party: <strong>${b.party_size} Explorers</strong></span>
                </div>
            </div>

            <div class="flex items-center justify-between pt-3 border-t border-slate-800 text-xs font-mono">
                <span class="text-emerald-400 font-bold">$${b.total_amount.toFixed(2)} USD</span>
                ${b.status === 'Confirmed' ? `
                    <button onclick="cancelBooking(${b.id})" class="text-slate-500 hover:text-red-400 transition-colors">
                        Cancel Permit
                    </button>
                ` : `
                    <span class="text-slate-600">Inactive</span>
                `}
            </div>
        </div>
    `).join("");
    lucide.createIcons();
}

function openBookingModalForSpot(spotId) {
    const spot = spots.find(s => s.id === spotId);
    if (!spot) return;

    document.getElementById("booking-spot-id").value = spot.id;
    document.getElementById("booking-spot-name").value = spot.name;
    document.getElementById("booking-date").value = new Date().toISOString().split('T')[0];
    calculateBookingTotal();

    const modal = document.getElementById("booking-modal");
    modal.classList.remove("hidden");
    modal.classList.add("flex");
}

function openBookingFromModal() {
    if (!currentSpot) return;
    closeSpotDetailModal();
    openBookingModalForSpot(currentSpot.id);
}

function closeBookingModal() {
    const modal = document.getElementById("booking-modal");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

function calculateBookingTotal() {
    const party = parseInt(document.getElementById("booking-party").value || 1);
    const total = party * 15.0;
    document.getElementById("booking-total-price").innerText = `$${total.toFixed(2)} USD`;
}

async function handleBookingSubmit(e) {
    e.preventDefault();
    const spotId = document.getElementById("booking-spot-id").value;
    const date = document.getElementById("booking-date").value;
    const party = parseInt(document.getElementById("booking-party").value);
    const type = document.getElementById("booking-type").value;
    const requests = document.getElementById("booking-requests").value.trim();
    const total = party * 15.0;

    try {
        const res = await fetch("/api/bookings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                spot_id: spotId ? parseInt(spotId) : null,
                booking_type: type,
                travel_date: date,
                party_size: party,
                total_amount: total,
                special_requests: requests
            })
        });

        const data = await res.json();
        if (data.success) {
            closeBookingModal();
            await loadUserBookings();
            showToast(data.message, "ticket");
            switchView("dashboard");
            setDashboardTab("bookings");
        } else {
            showToast(data.error || "Reservation failed", "alert-circle");
        }
    } catch (err) {
        console.error("Booking error", err);
    }
}

async function cancelBooking(bookingId) {
    if (!confirm("Are you sure you want to cancel this conservation permit?")) return;
    try {
        await fetch(`/api/bookings/${bookingId}/cancel`, { method: "POST" });
        await loadUserBookings();
        showToast("Reservation cancelled", "info");
    } catch (e) {
        console.error("Cancel booking error", e);
    }
}

// ============================================================
// 6. CONTACT CONCIERGE
// ============================================================
function openContactModal() {
    if (currentUser) {
        const nameEl = document.getElementById("contact-name");
        const emailEl = document.getElementById("contact-email");
        if (nameEl) nameEl.value = currentUser.display_name;
        if (emailEl) emailEl.value = currentUser.email;
    }
    document.getElementById("contact-modal").classList.remove("hidden");
    document.getElementById("contact-modal").classList.add("flex");
}

function closeContactModal() {
    document.getElementById("contact-modal").classList.add("hidden");
    document.getElementById("contact-modal").classList.remove("flex");
}

async function handleContactSubmit(e) {
    e.preventDefault();
    const name = document.getElementById("contact-name").value.trim();
    const email = document.getElementById("contact-email").value.trim();
    const subject = document.getElementById("contact-subject").value.trim();
    const message = document.getElementById("contact-message").value.trim();

    try {
        const res = await fetch("/api/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, email, subject, message })
        });
        const data = await res.json();
        if (data.success) {
            closeContactModal();
            showToast(data.message, "send");
        } else {
            showToast(data.error || "Submission failed", "alert-circle");
        }
    } catch (err) {
        console.error("Contact error", err);
    }
}

// ============================================================
// 7. SANCTUARIES, WISHLIST & RIDDLES
// ============================================================
async function loadSpots() {
    try {
        const username = currentUser ? currentUser.display_name.toLowerCase() : "purvaj";
        let url = `/api/spots?username=${encodeURIComponent(username)}&min_solitude=${minSolitude}`;
        if (activeCategory && activeCategory !== "All") {
            url += `&category=${encodeURIComponent(activeCategory)}`;
        }
        if (searchQuery) {
            url += `&q=${encodeURIComponent(searchQuery)}`;
        }

        const res = await fetch(url);
        spots = await res.json();

        renderSpotsList(spots);
        renderMainMapMarkers(spots);
        await loadWishlist();
        lucide.createIcons();
    } catch (err) {
        console.error("Failed to fetch spots:", err);
    }
}

function renderSpotsList(spotItems) {
    const container = document.getElementById("spots-list");
    const countBadge = document.getElementById("spots-count-badge");
    if (!container) return;

    if (countBadge) countBadge.innerText = `${spotItems.length} sanctuaries mapped`;

    if (spotItems.length === 0) {
        container.innerHTML = `
            <div class="p-8 text-center rounded-xl bg-[#0F172A] border border-slate-800 space-y-2">
                <i data-lucide="compass" class="w-8 h-8 text-slate-600 mx-auto"></i>
                <div class="font-display font-semibold text-slate-300">No Sanctuaries Match Your Criteria</div>
                <button onclick="resetFilters()" class="px-3 py-1.5 rounded-md bg-slate-800 text-xs font-mono text-sky-400 hover:text-sky-300">Reset Filters</button>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    container.innerHTML = spotItems.map(spot => {
        const isProtected = spot.is_protected && !unlockedSpots.includes(spot.id);
        const isBookmarked = bookmarkedSpotIds.has(spot.id);

        return `
            <div class="spot-card bg-[#0F172A] border border-slate-800 rounded-xl overflow-hidden cursor-pointer group" onclick="openSpotDetail(${spot.id})">
                <div class="flex flex-col sm:flex-row h-full">
                    <div class="relative w-full sm:w-44 h-36 sm:h-auto shrink-0 overflow-hidden">
                        <img src="${escapeHtml(spot.image_url)}" alt="${escapeHtml(spot.name)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
                        <div class="absolute inset-0 bg-gradient-to-t sm:bg-gradient-to-r from-[#0F172A]/90 via-transparent to-transparent"></div>
                        <div class="absolute top-2 left-2 px-2 py-0.5 rounded bg-[#0B0F19]/80 backdrop-blur-sm border border-slate-700/80 text-[10px] font-mono text-sky-400 font-medium">
                            ${escapeHtml(spot.category)}
                        </div>
                        <button onclick="event.stopPropagation(); toggleBookmark(${spot.id})" title="Save to Expedition Wishlist"
                                class="absolute top-2 right-2 w-7 h-7 rounded-md bg-[#0B0F19]/80 backdrop-blur-sm border border-slate-700/80 flex items-center justify-center text-slate-400 hover:text-sky-400 transition-colors">
                            <i data-lucide="bookmark" class="w-3.5 h-3.5 ${isBookmarked ? 'bookmark-active' : ''}"></i>
                        </button>
                    </div>

                    <div class="p-3.5 flex-1 flex flex-col justify-between space-y-2">
                        <div>
                            <div class="flex items-start justify-between gap-2">
                                <h4 class="font-display font-bold text-white text-sm group-hover:text-sky-400 transition-colors tracking-tight">
                                    ${escapeHtml(spot.name)}
                                </h4>
                                <span class="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-mono font-medium bg-sky-500/10 text-sky-400 border border-sky-500/25 flex items-center gap-1">
                                    <i data-lucide="sparkles" class="w-2.5 h-2.5"></i>
                                    ${spot.match_percentage}% Match
                                </span>
                            </div>

                            <div class="text-xs text-slate-400 font-mono flex items-center gap-1 mt-0.5">
                                <i data-lucide="map-pin" class="w-3 h-3 text-slate-500"></i>
                                <span>${escapeHtml(spot.region)}, ${escapeHtml(spot.country)}</span>
                            </div>

                            <div class="text-[11px] font-mono text-emerald-400/90 mt-1 flex items-center gap-1">
                                <i data-lucide="check" class="w-3 h-3"></i>
                                <span>${escapeHtml(spot.match_reason)}</span>
                            </div>

                            <p class="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                                ${escapeHtml(spot.tagline)}
                            </p>
                        </div>

                        <div class="flex items-center justify-between pt-2 border-t border-slate-800 text-[11px] font-mono">
                            <div class="flex items-center gap-3">
                                <span class="text-emerald-400 font-medium" title="Solitude Index">
                                    <i data-lucide="shield" class="w-3 h-3 inline mr-0.5"></i> ${spot.solitude_score}%
                                </span>
                                <span class="text-sky-400 font-medium" title="Quietness Decibel">
                                    <i data-lucide="volume-2" class="w-3 h-3 inline mr-0.5"></i> ${spot.decibel_level} dB
                                </span>
                            </div>

                            <div class="flex items-center gap-2">
                                <button onclick="event.stopPropagation(); openBookingModalForSpot(${spot.id})" class="px-2.5 py-1 rounded-md bg-emerald-500 hover:bg-emerald-400 text-[#0B0F19] font-mono text-[10px] font-bold transition-colors">
                                    Permit
                                </button>
                                ${isProtected ? `
                                    <span class="text-[10px] font-mono px-2 py-1 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center gap-1 font-medium">
                                        <i data-lucide="lock" class="w-3 h-3"></i> Riddle
                                    </span>
                                ` : `
                                    <span class="text-[10px] font-mono px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 font-medium">
                                        <i data-lucide="unlock" class="w-3 h-3"></i> GPS Open
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

async function openSpotDetail(spotId) {
    try {
        const username = currentUser ? currentUser.display_name.toLowerCase() : "purvaj";
        const res = await fetch(`/api/spots/${spotId}?username=${encodeURIComponent(username)}`);
        currentSpot = await res.json();

        document.getElementById("modal-img").src = currentSpot.image_url;
        document.getElementById("modal-title").innerText = currentSpot.name;
        document.getElementById("modal-category").innerText = currentSpot.category;
        document.getElementById("modal-region").innerText = `${currentSpot.region}, ${currentSpot.country}`;
        document.getElementById("modal-upvotes-count").innerText = currentSpot.upvotes;
        document.getElementById("modal-solitude").innerText = `${currentSpot.solitude_score}/100`;
        document.getElementById("modal-decibel").innerText = `${currentSpot.decibel_level} dB`;
        document.getElementById("modal-signal").innerText = currentSpot.cell_signal;
        document.getElementById("modal-lore").innerText = currentSpot.lore;
        document.getElementById("modal-guardian-name").innerText = currentSpot.guardian_name;
        document.getElementById("modal-guardian-title").innerText = currentSpot.guardian_title;
        document.getElementById("modal-lnt").innerText = currentSpot.leave_no_trace_notes;

        const matchPercent = document.getElementById("modal-match-percent");
        const matchReason = document.getElementById("modal-match-reason");
        if (matchPercent) matchPercent.innerText = `${currentSpot.match_percentage || 95}% Match`;
        if (matchReason) matchReason.innerText = currentSpot.match_reason || "Matches your solitude vibe";

        updateModalBookmarkUI();
        renderCoordinatesSection();
        renderFieldNotes(currentSpot.notes || []);

        const modal = document.getElementById("spot-detail-modal");
        modal.classList.remove("hidden");
        modal.classList.add("flex");
        lucide.createIcons();
    } catch (err) {
        console.error("Error loading spot detail", err);
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
        if (isBookmarked) icon.classList.add("bookmark-active");
        else icon.classList.remove("bookmark-active");
    }
}

function renderCoordinatesSection() {
    const section = document.getElementById("coordinates-section");
    if (!currentSpot || !section) return;

    const isAlreadyUnlocked = !currentSpot.is_protected || unlockedSpots.includes(currentSpot.id);

    if (isAlreadyUnlocked) {
        section.className = "rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-5 space-y-3";
        section.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 text-emerald-400 font-mono text-xs font-bold">
                    <i data-lucide="unlock" class="w-4 h-4"></i>
                    AUTHENTICATED WAYPOINT (PRESERVE ETHOS)
                </div>
                <span class="text-[10px] font-mono text-slate-400">Leave No Trace Verified</span>
            </div>
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#0B0F19] p-3.5 rounded-lg border border-slate-800">
                <div class="font-mono text-sm text-slate-200">
                    <span class="text-slate-500">COORDS:</span> ${currentSpot.latitude.toFixed(4)}° N, ${currentSpot.longitude.toFixed(4)}° E
                </div>
                <div class="flex items-center gap-2">
                    <a href="https://www.google.com/maps/search/?api=1&query=${currentSpot.latitude},${currentSpot.longitude}" target="_blank" rel="noopener noreferrer"
                       class="px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-sky-400 text-xs font-mono flex items-center gap-1">
                        <i data-lucide="external-link" class="w-3.5 h-3.5"></i> Google Maps
                    </a>
                    <button onclick="downloadGPX(${currentSpot.id})" class="px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-[#0B0F19] font-bold text-xs font-mono flex items-center gap-1">
                        <i data-lucide="download" class="w-3.5 h-3.5"></i> GPX Waypoint
                    </button>
                </div>
            </div>
        `;
    } else {
        section.className = "rounded-xl border border-amber-500/30 bg-amber-950/20 p-5 space-y-3";
        section.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 text-amber-400 font-mono text-xs font-bold">
                    <i data-lucide="shield-alert" class="w-4 h-4"></i>
                    FRAGILE SANCTUARY — COORDINATES SAFEGUARDED
                </div>
                <div class="flex items-center gap-2">
                    <button onclick="autoFillRiddleDemo()" class="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-[10px] font-mono text-amber-300 font-semibold">
                        ⚡ Demo Auto-Fill
                    </button>
                </div>
            </div>
            <p class="text-xs text-slate-300">
                To protect this fragile haven from mass tourist exploitation, solve the guardian's riddle hidden in the lore.
            </p>
            <div class="bg-[#0B0F19] p-3.5 rounded-lg border border-slate-800 space-y-2">
                <div class="text-xs font-mono text-slate-200 font-semibold flex items-center gap-2">
                    <i data-lucide="help-circle" class="w-4 h-4 text-amber-400"></i>
                    ${escapeHtml(currentSpot.riddle_question || "What natural element shelters this sanctuary?")}
                </div>
                <div class="flex gap-2">
                    <input id="riddle-answer-input" type="text" placeholder="Type answer keyword from the lore..."
                           class="flex-1 bg-[#0F172A] border border-slate-700 px-3 py-2 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-sky-500">
                    <button onclick="submitRiddleSolution()" class="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-[#0B0F19] font-bold text-xs font-mono uppercase transition-colors">
                        Solve Lore
                    </button>
                </div>
                <div id="riddle-hint-box" class="hidden text-[11px] font-mono text-amber-300/80 pt-1">
                    <span class="text-slate-500">Guardian Whisper:</span> <span id="riddle-hint-text"></span>
                </div>
            </div>
        `;
    }
}

function autoFillRiddleDemo() {
    if (!currentSpot) return;
    const input = document.getElementById("riddle-answer-input");
    if (input && currentSpot.riddle_answer) {
        input.value = currentSpot.riddle_answer;
        showToast(`Auto-filled keyword: "${currentSpot.riddle_answer}". Click Solve Lore!`, "sparkles");
    }
}

async function submitRiddleSolution() {
    const input = document.getElementById("riddle-answer-input");
    if (!input || !currentSpot) return;

    const answer = input.value.trim();
    if (!answer) return;

    try {
        const res = await fetch(`/api/spots/${currentSpot.id}/unlock`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answer })
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
            showToast("Lore Decrypted! Exact coordinates unlocked.", "award");
        } else {
            const hintBox = document.getElementById("riddle-hint-box");
            const hintText = document.getElementById("riddle-hint-text");
            if (hintBox && hintText) {
                hintBox.classList.remove("hidden");
                hintText.innerText = data.hint || "Review the field notes.";
            }
            showToast(data.message || "Incorrect answer", "shield-alert");
        }
    } catch (e) {
        console.error("Unlock error", e);
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
            showToast("Echo recorded", "heart");
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
        container.innerHTML = `<div class="p-4 rounded-xl bg-obsidian-950 text-slate-500 text-xs font-mono text-center">No field notes yet.</div>`;
        return;
    }

    container.innerHTML = notes.map(note => `
        <div class="bg-obsidian-950 p-3 rounded-xl border border-slate-800 space-y-1 text-xs">
            <div class="flex items-center justify-between">
                <span class="font-bold text-slate-200 font-mono">${escapeHtml(note.author_name)} <span class="text-amberGold-400">(${escapeHtml(note.author_badge)})</span></span>
                <span class="text-slate-500 text-[10px]">${escapeHtml(note.created_at)}</span>
            </div>
            <p class="text-slate-300 font-sans">${escapeHtml(note.content)}</p>
        </div>
    `).join("");
}

async function submitFieldNote() {
    if (!currentSpot) return;
    const author = document.getElementById("note-author").value.trim() || (currentUser ? currentUser.display_name : "Explorer");
    const badge = document.getElementById("note-badge").value;
    const type = document.getElementById("note-type").value;
    const content = document.getElementById("note-content").value.trim();

    if (!content) return;

    try {
        const res = await fetch(`/api/spots/${currentSpot.id}/notes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ author_name: author, author_badge: badge, note_type: type, content })
        });
        const data = await res.json();
        if (data.success) {
            document.getElementById("note-content").value = "";
            openSpotDetail(currentSpot.id);
            showToast("Field whisper submitted", "check-circle");
        }
    } catch (e) {
        console.error("Submit note error", e);
    }
}

function downloadGPX(spotId) {
    if (!currentSpot) return;
    const gpxContent = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="WanderLore Anti-Overtourism Network">
  <wpt lat="${currentSpot.latitude}" lon="${currentSpot.longitude}">
    <name>${currentSpot.name}</name>
    <desc>${currentSpot.tagline} - Solitude: ${currentSpot.solitude_score}/100. Leave No Trace.</desc>
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
    showToast("GPX Waypoint Downloaded", "download");
}

// Wishlist / Bookmarks
async function loadWishlist() {
    try {
        const username = currentUser ? currentUser.display_name.toLowerCase() : "purvaj";
        const res = await fetch(`/api/bookmarks?username=${encodeURIComponent(username)}`);
        const saved = await res.json();
        bookmarkedSpotIds = new Set(saved.map(s => s.id));

        const countEl = document.getElementById("dash-wishlist-count");
        if (countEl) countEl.innerText = saved.length;

        renderWishlistGrid(saved);
    } catch (e) {
        console.error("Failed to load wishlist", e);
    }
}

async function toggleBookmark(spotId) {
    try {
        const username = currentUser ? currentUser.display_name.toLowerCase() : "purvaj";
        const res = await fetch("/api/bookmarks/toggle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, spot_id: spotId })
        });
        const data = await res.json();
        if (data.success) {
            if (data.is_bookmarked) bookmarkedSpotIds.add(spotId);
            else bookmarkedSpotIds.delete(spotId);
            await loadWishlist();
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

function renderWishlistGrid(saved) {
    const grid = document.getElementById("dash-wishlist-grid");
    if (!grid) return;

    if (saved.length === 0) {
        grid.innerHTML = `<div class="col-span-full p-6 text-center rounded-xl bg-obsidian-950 text-slate-500 text-xs font-mono">No sanctuaries saved yet.</div>`;
        return;
    }

    grid.innerHTML = saved.map(s => `
        <div class="bg-obsidian-950 border border-slate-800 rounded-xl overflow-hidden p-4 space-y-2">
            <h4 class="font-cinzel font-bold text-slate-100 text-sm">${escapeHtml(s.name)}</h4>
            <div class="text-xs font-mono text-slate-400">${escapeHtml(s.region)}, ${escapeHtml(s.country)}</div>
            <div class="flex items-center justify-between pt-2 border-t border-slate-900 text-xs font-mono">
                <button onclick="openSpotDetail(${s.id})" class="text-amberGold-400 hover:underline">View Lore</button>
                <button onclick="openBookingModalForSpot(${s.id})" class="text-emeraldGlow-400 hover:underline">Book Permit</button>
            </div>
        </div>
    `).join("");
}

// ============================================================
// 8. THE COMMONS, EXPEDITIONS & DISCUSSIONS
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
        <div class="bg-obsidian-900 border border-slate-800 rounded-xl p-5 space-y-3">
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
                <div class="flex items-center gap-2">
                    <span class="text-xs font-mono text-slate-300">Roster: ${exp.current_participants}/${exp.max_participants}</span>
                    <button onclick="joinExpedition(${exp.id})" ${exp.current_participants >= exp.max_participants ? 'disabled' : ''}
                            class="px-3 py-1.5 rounded bg-emeraldGlow-500 hover:bg-emeraldGlow-400 disabled:bg-slate-800 text-obsidian-950 font-bold text-xs font-mono uppercase">
                        ${exp.current_participants >= exp.max_participants ? 'Full' : 'Join'}
                    </button>
                </div>
            </div>
            <p class="text-xs text-slate-300">${escapeHtml(exp.description)}</p>
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
                <span class="text-slate-500">2h ago</span>
            </div>
            <p class="text-slate-300">"Anza-Borrego solstice washboard road ruts cleared. Total Bortle 1 silence."</p>
        </div>
        <div class="p-3 bg-obsidian-950 border border-slate-800 rounded-xl text-xs space-y-1">
            <div class="flex items-center justify-between font-mono text-[10px]">
                <span class="text-emeraldGlow-400">Nohwet Bridge Steward</span>
                <span class="text-slate-500">4h ago</span>
            </div>
            <p class="text-slate-300">"River pool is crystal emerald. Please remove shoes on living root bridge."</p>
        </div>
    `;
}

async function joinExpedition(expId) {
    try {
        const res = await fetch(`/api/expeditions/${expId}/join`, { method: "POST" });
        const data = await res.json();
        if (data.success) {
            loadExpeditions();
            showToast("You joined the expedition!", "compass");
        }
    } catch (e) {
        console.error("Join error", e);
    }
}

async function loadDiscussions() {
    try {
        const res = await fetch("/api/discussions");
        discussions = await res.json();
        const container = document.getElementById("discussions-list");
        if (!container) return;

        container.innerHTML = discussions.map(d => `
            <div class="bg-obsidian-900 border border-slate-800 rounded-xl p-5 space-y-2 text-xs">
                <span class="px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 font-mono text-[10px]">${escapeHtml(d.category)}</span>
                <h4 class="font-cinzel font-bold text-slate-100 text-sm">${escapeHtml(d.title)}</h4>
                <p class="text-slate-300 font-sans">${escapeHtml(d.content)}</p>
                <div class="flex items-center justify-between pt-2 border-t border-slate-800 text-[11px] font-mono text-slate-500">
                    <span>${escapeHtml(d.author_name)}</span>
                    <button onclick="upvoteDiscussion(${d.id})" class="text-slate-400 hover:text-amberGold-400 flex items-center gap-1">
                        <i data-lucide="thumbs-up" class="w-3 h-3"></i> ${d.upvotes}
                    </button>
                </div>
            </div>
        `).join("");
        lucide.createIcons();
    } catch (e) {
        console.error("Discussions error", e);
    }
}

async function upvoteDiscussion(discId) {
    try {
        await fetch(`/api/discussions/${discId}/upvote`, { method: "POST" });
        loadDiscussions();
    } catch (e) {
        console.error("Upvote error", e);
    }
}

// ============================================================
// 9. AMBIENT NATURE SYNTHESIZER (Web Audio API)
// ============================================================
function toggleAmbientAudio() {
    if (!audioIsPlaying) startAmbientAudio();
    else stopAmbientAudio();
}

function startAmbientAudio() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();

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
            output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
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
        showToast("Soundscape active: Mountain Wind Solitude", "volume-2");
    } catch (e) {
        console.error("Audio error", e);
    }
}

function stopAmbientAudio() {
    if (audioGain && audioCtx) {
        audioGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1);
        setTimeout(() => {
            if (audioNoiseNode) audioNoiseNode.stop();
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
        status.innerText = "Wind Ambience";
    } else {
        icon.setAttribute("data-lucide", "volume-x");
        icon.classList.remove("text-amberGold-400");
        status.innerText = "Solitude Silence";
    }
    lucide.createIcons();
}

// ============================================================
// 10. NAVIGATION & EVENT LISTENERS
// ============================================================
function setupEventListeners() {
    // Global Keyboard Shortcuts (⌘K / Ctrl+K and ESC)
    document.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
            e.preventDefault();
            const modal = document.getElementById("command-palette-modal");
            if (modal && !modal.classList.contains("hidden")) {
                closeCommandPalette();
            } else {
                openCommandPalette();
            }
        } else if (e.key === "Escape") {
            closeCommandPalette();
            closeSpotDetailModal();
            closeLoginModal();
            closeRegisterModal();
            closeForgotModal();
            closeBookingModal();
            closeCreateTripModal();
            closeAddWaypointModal();
            closeContactModal();
            closeGmapsConfigModal();
            closeSubmitModal();
        }
    });

    const cmdInput = document.getElementById("command-palette-input");
    if (cmdInput) {
        cmdInput.addEventListener("input", (e) => {
            renderCommandPaletteResults(e.target.value);
        });
    }

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

    const slider = document.getElementById("solitude-slider");
    const sliderVal = document.getElementById("solitude-val");
    if (slider) {
        slider.addEventListener("input", (e) => {
            minSolitude = parseInt(e.target.value);
            if (sliderVal) sliderVal.innerText = `${minSolitude}%`;
            loadSpots();
        });
    }

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

// ============================================================
// COMMAND PALETTE (⌘K / Ctrl+K) SPOTLIGHT ENGINE
// ============================================================
function openCommandPalette() {
    const modal = document.getElementById("command-palette-modal");
    const input = document.getElementById("command-palette-input");
    if (!modal) return;
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    if (input) {
        input.value = "";
        setTimeout(() => input.focus(), 50);
        renderCommandPaletteResults("");
    }
}

function closeCommandPalette() {
    const modal = document.getElementById("command-palette-modal");
    if (!modal) return;
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

function renderCommandPaletteResults(query) {
    const container = document.getElementById("command-palette-results");
    if (!container) return;

    const q = (query || "").toLowerCase().trim();

    const defaultActions = [
        { type: "action", title: "Explore Sanctuaries", subtitle: "Switch to interactive map & directory", icon: "compass", action: () => switchView("explore") },
        { type: "action", title: "Expeditions & Waypoint Routes", subtitle: "Open route planning visualizer", icon: "map", action: () => { switchView("dashboard"); setDashboardTab("itineraries"); } },
        { type: "action", title: "New Expedition Itinerary", subtitle: "Assemble multi-day route and waypoints", icon: "plus-circle", action: () => openCreateTripModal() },
        { type: "action", title: "Sanctuary Concierge", subtitle: "Submit permit or trail inquiries", icon: "headphones", action: () => openContactModal() },
        { type: "action", title: "Configure Cartography Engine", subtitle: "Google Maps API / CartoDB Dark Matter", icon: "settings-2", action: () => openGmapsConfigModal() },
        { type: "action", title: "Toggle Soundscape of Solitude", subtitle: "Generative acoustic wind audio", icon: "volume-2", action: () => toggleAmbientAudio() },
        { type: "action", title: "The Commons & Tribes", subtitle: "Join low-impact community expeditions", icon: "users", action: () => switchView("commons") }
    ];

    const matchingSpots = (spots || []).filter(s => 
        !q || 
        s.name.toLowerCase().includes(q) || 
        s.category.toLowerCase().includes(q) || 
        s.region.toLowerCase().includes(q) || 
        s.country.toLowerCase().includes(q)
    ).slice(0, 6);

    const matchingActions = defaultActions.filter(a => 
        !q || 
        a.title.toLowerCase().includes(q) || 
        a.subtitle.toLowerCase().includes(q)
    );

    const matchingTrips = (userTrips || []).filter(t =>
        !q ||
        t.title.toLowerCase().includes(q) ||
        t.destination.toLowerCase().includes(q)
    ).slice(0, 3);

    let html = "";

    if (matchingActions.length > 0) {
        html += `<div class="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold">Quick Actions</div>`;
        matchingActions.forEach((act, idx) => {
            html += `
                <div onclick="executeCommandAction(${idx})" class="command-item p-2.5 rounded-lg flex items-center justify-between cursor-pointer text-xs text-slate-200 hover:bg-slate-800 transition-colors">
                    <div class="flex items-center gap-3">
                        <div class="w-7 h-7 rounded-md bg-sky-500/10 text-sky-400 flex items-center justify-center shrink-0">
                            <i data-lucide="${act.icon}" class="w-3.5 h-3.5"></i>
                        </div>
                        <div>
                            <div class="font-medium text-slate-100">${escapeHtml(act.title)}</div>
                            <div class="text-[10px] text-slate-400 font-mono">${escapeHtml(act.subtitle)}</div>
                        </div>
                    </div>
                    <kbd class="text-[10px] font-mono text-slate-500">↵ Jump</kbd>
                </div>
            `;
        });
    }

    if (matchingSpots.length > 0) {
        html += `<div class="px-2 pt-2.5 pb-1 text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold">Sanctuaries (${matchingSpots.length})</div>`;
        matchingSpots.forEach(s => {
            html += `
                <div onclick="selectSpotFromCommand(${s.id})" class="command-item p-2.5 rounded-lg flex items-center justify-between cursor-pointer text-xs text-slate-200 hover:bg-slate-800 transition-colors">
                    <div class="flex items-center gap-3">
                        <img src="${escapeHtml(s.image_url)}" class="w-7 h-7 rounded-md object-cover bg-slate-800 shrink-0" alt="">
                        <div>
                            <div class="font-medium text-slate-100">${escapeHtml(s.name)}</div>
                            <div class="text-[10px] text-slate-400 font-mono">${escapeHtml(s.region)}, ${escapeHtml(s.country)} • <span class="text-emerald-400">${s.solitude_score}% Solitude</span></div>
                        </div>
                    </div>
                    <span class="text-[10px] font-mono text-sky-400">View Sanctuary</span>
                </div>
            `;
        });
    }

    if (matchingTrips.length > 0) {
        html += `<div class="px-2 pt-2.5 pb-1 text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold">Expeditions (${matchingTrips.length})</div>`;
        matchingTrips.forEach(t => {
            html += `
                <div onclick="selectTripFromCommand(${t.id})" class="command-item p-2.5 rounded-lg flex items-center justify-between cursor-pointer text-xs text-slate-200 hover:bg-slate-800 transition-colors">
                    <div class="flex items-center gap-3">
                        <div class="w-7 h-7 rounded-md bg-purple-500/10 text-purple-400 flex items-center justify-center shrink-0">
                            <i data-lucide="map-pin" class="w-3.5 h-3.5"></i>
                        </div>
                        <div>
                            <div class="font-medium text-slate-100">${escapeHtml(t.title)}</div>
                            <div class="text-[10px] text-slate-400 font-mono">${escapeHtml(t.destination)} • ${escapeHtml(t.start_date)}</div>
                        </div>
                    </div>
                    <span class="text-[10px] font-mono text-purple-400">Open Route</span>
                </div>
            `;
        });
    }

    if (!html) {
        html = `
            <div class="p-6 text-center text-xs font-mono text-slate-500">
                No matching sanctuaries, expeditions, or actions found for "${escapeHtml(q)}".
            </div>
        `;
    }

    container.innerHTML = html;
    lucide.createIcons();
    window._currentCommandActions = matchingActions;
}

function executeCommandAction(index) {
    closeCommandPalette();
    if (window._currentCommandActions && window._currentCommandActions[index]) {
        window._currentCommandActions[index].action();
    }
}

function selectSpotFromCommand(spotId) {
    closeCommandPalette();
    switchView("explore");
    openSpotDetail(spotId);
}

function selectTripFromCommand(tripId) {
    closeCommandPalette();
    switchView("dashboard");
    setDashboardTab("itineraries");
    selectTrip(tripId);
}

function applyCategoryFilter(catName) {
    activeCategory = catName;
    document.querySelectorAll(".cat-pill").forEach(p => {
        if (p.getAttribute("data-category") === catName) p.classList.add("active");
        else p.classList.remove("active");
    });
    loadSpots();
    switchView("explore");
}

function resetFilters() {
    activeCategory = "All";
    minSolitude = 0;
    searchQuery = "";
    document.getElementById("solitude-slider").value = 0;
    document.getElementById("solitude-val").innerText = "0%";
    document.getElementById("search-input").value = "";
    document.querySelectorAll(".cat-pill").forEach(p => {
        if (p.getAttribute("data-category") === "All") p.classList.add("active");
        else p.classList.remove("active");
    });
    loadSpots();
}

function switchView(viewName) {
    const views = ["explore", "dashboard", "commons"];
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

    if (viewName === "explore" && mainMap) {
        setTimeout(() => mainMap.invalidateSize(), 200);
    }
    if (viewName === "dashboard") {
        loadUserTrips();
        loadUserBookings();
    }
}

function setDashboardTab(tabName) {
    const tabs = ["itineraries", "bookings", "wishlist", "account"];
    tabs.forEach(t => {
        const subview = document.getElementById(`subview-${t}`);
        const btn = document.getElementById(`tab-dash-${t}`);
        if (t === tabName) {
            if (subview) subview.classList.remove("hidden");
            if (btn) {
                btn.className = "px-3.5 py-2 rounded-lg bg-slate-800 text-sky-400 font-semibold border border-sky-500/30 flex items-center gap-2";
            }
        } else {
            if (subview) subview.classList.add("hidden");
            if (btn) {
                btn.className = "px-3.5 py-2 rounded-lg bg-transparent text-slate-400 hover:text-slate-200 flex items-center gap-2";
            }
        }
    });

    if (tabName === "itineraries" && tripMap) {
        setTimeout(() => tripMap.invalidateSize(), 200);
    }
    if (tabName === "wishlist") {
        loadWishlist();
    }
}

function setDisplayMode(mode) {
    const mapWrapper = document.getElementById("map-wrapper");
    const gridWrapper = document.getElementById("grid-wrapper");
    const toggleSplit = document.getElementById("toggle-split");
    const toggleMap = document.getElementById("toggle-map");
    const toggleGrid = document.getElementById("toggle-grid");

    [toggleSplit, toggleMap, toggleGrid].forEach(b => {
        if (b) b.className = "px-3 py-1 rounded-md font-medium text-slate-400 hover:text-slate-200";
    });

    if (mode === "split") {
        mapWrapper.className = "lg:col-span-7 flex flex-col rounded-xl overflow-hidden border border-slate-800 bg-[#0F172A] shadow-sm relative";
        gridWrapper.className = "lg:col-span-5 flex flex-col space-y-3";
        mapWrapper.classList.remove("hidden");
        gridWrapper.classList.remove("hidden");
        toggleSplit.className = "px-3 py-1 rounded-md font-medium text-sky-400 bg-slate-800";
    } else if (mode === "map") {
        mapWrapper.className = "col-span-12 flex flex-col rounded-xl overflow-hidden border border-slate-800 bg-[#0F172A] shadow-sm relative min-h-[600px]";
        gridWrapper.classList.add("hidden");
        mapWrapper.classList.remove("hidden");
        toggleMap.className = "px-3 py-1 rounded-md font-medium text-sky-400 bg-slate-800";
    } else if (mode === "grid") {
        gridWrapper.className = "col-span-12 flex flex-col space-y-3";
        mapWrapper.classList.add("hidden");
        gridWrapper.classList.remove("hidden");
        toggleGrid.className = "px-3 py-1 rounded-md font-medium text-sky-400 bg-slate-800";
    }

    if (mainMap) setTimeout(() => mainMap.invalidateSize(), 250);
}

// Global Toast
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
    toastTimer = setTimeout(() => toast.classList.remove("toast-visible"), 4000);
}

function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag] || tag));
}

async function fetchStats() {
    try {
        const res = await fetch("/api/stats");
        const stats = await res.json();
        const statS = document.getElementById("stat-sanctuaries");
        const statSol = document.getElementById("stat-solitude");
        const statDec = document.getElementById("stat-decibel");
        const statPermits = document.getElementById("stat-permits");

        if (statS) statS.innerText = stats.total_sanctuaries;
        if (statSol) statSol.innerText = `${stats.avg_solitude_score}%`;
        if (statDec) statDec.innerText = `${stats.avg_decibel_level} dB`;
        if (statPermits) statPermits.innerText = stats.confirmed_permits || 2;
    } catch (e) {
        console.error("Failed to load stats", e);
    }
}
