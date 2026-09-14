import os
import secrets
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, session, send_file
from werkzeug.security import generate_password_hash, check_password_hash
from database import get_db_connection, init_db

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "wanderlore-luxury-secret-key-2026-prod")

# Initialize DB tables
init_db()

def get_current_user():
    user_id = session.get("user_id")
    conn = get_db_connection()
    cursor = conn.cursor()

    if user_id:
        cursor.execute("SELECT id, email, display_name, avatar_url, title, bio, role, created_at FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return dict(row)

    # Fallback to query param or demo user (Purvaj) for testing
    auth_email = request.headers.get("X-User-Email") or request.args.get("user_email")
    if auth_email:
        cursor.execute("SELECT id, email, display_name, avatar_url, title, bio, role, created_at FROM users WHERE email = ?", (auth_email,))
        row = cursor.fetchone()
        conn.close()
        if row:
            return dict(row)

    # Default demo user (Purvaj)
    cursor.execute("SELECT id, email, display_name, avatar_url, title, bio, role, created_at FROM users WHERE id = 1")
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/download")
@app.route("/api/download")
def download_zip():
    candidates = [
        os.path.join(os.path.dirname(__file__), "..", "wanderlore.zip"),
        os.path.join(os.path.dirname(__file__), "wanderlore.zip"),
        os.path.join(os.path.expanduser("~"), "Downloads", "wanderlore.zip"),
        os.path.join(os.environ.get("USERPROFILE", ""), "OneDrive", "Desktop", "wanderlore.zip"),
    ]
    for p in candidates:
        if os.path.exists(p):
            return send_file(p, as_attachment=True, download_name="wanderlore.zip")
    return jsonify({"error": "Zip archive not found"}), 404

# ============================================================
# 1. USER AUTHENTICATION API
# ============================================================
@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    data = request.get_json() or {}
    email = data.get("email", "").strip().lower()
    password = data.get("password", "").strip()
    display_name = data.get("display_name", "").strip() or email.split("@")[0].capitalize()
    title = data.get("title", "Offbeat Explorer").strip()

    if not email or "@" not in email:
        return jsonify({"error": "A valid email address is required"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
    if cursor.fetchone():
        conn.close()
        return jsonify({"error": "An account with this email already exists"}), 409

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    pwd_hash = generate_password_hash(password)
    avatar = f"https://api.dicebear.com/7.x/bottts/svg?seed={email}"

    cursor.execute("""
    INSERT INTO users (email, password_hash, display_name, avatar_url, title, bio, role, created_at)
    VALUES (?, ?, ?, ?, ?, '', 'explorer', ?)
    """, (email, pwd_hash, display_name, avatar, title, now))
    conn.commit()
    user_id = cursor.lastrowid

    # Create associated profile
    username = email.split("@")[0].lower()
    cursor.execute("""
    INSERT OR IGNORE INTO user_profiles (username, display_name, title, badge, bio, avatar_icon, preferred_categories, created_at)
    VALUES (?, ?, ?, 'Pathfinder', 'Newly joined explorer committed to Leave-No-Trace.', 'compass', 'Stargazing Sanctuaries, Forgotten Ruins', ?)
    """, (username, display_name, title, now))
    conn.commit()

    session["user_id"] = user_id
    cursor.execute("SELECT id, email, display_name, avatar_url, title, bio, role, created_at FROM users WHERE id = ?", (user_id,))
    user = dict(cursor.fetchone())
    conn.close()

    return jsonify({
        "success": True,
        "message": "Welcome to WanderLore! Account successfully registered.",
        "user": user
    })

@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json() or {}
    email = data.get("email", "").strip().lower()
    password = data.get("password", "").strip()

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
    user_row = cursor.fetchone()

    if not user_row or not check_password_hash(user_row["password_hash"], password):
        conn.close()
        return jsonify({"error": "Invalid email or password"}), 401

    session["user_id"] = user_row["id"]
    user = {
        "id": user_row["id"],
        "email": user_row["email"],
        "display_name": user_row["display_name"],
        "avatar_url": user_row["avatar_url"],
        "title": user_row["title"],
        "bio": user_row["bio"],
        "role": user_row["role"]
    }
    conn.close()

    return jsonify({
        "success": True,
        "message": f"Welcome back, {user['display_name']}!",
        "user": user
    })

@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    session.pop("user_id", None)
    return jsonify({"success": True, "message": "Signed out successfully."})

@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    user = get_current_user()
    if not user:
        return jsonify({"authenticated": False, "user": None})
    return jsonify({"authenticated": True, "user": user})

@app.route("/api/auth/forgot-password", methods=["POST"])
def auth_forgot_password():
    data = request.get_json() or {}
    email = data.get("email", "").strip().lower()

    if not email:
        return jsonify({"error": "Email is required"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, display_name FROM users WHERE email = ?", (email,))
    user = cursor.fetchone()

    if not user:
        conn.close()
        return jsonify({"error": "No account found with this email address"}), 404

    # Generate 6-character alphanumeric reset token
    token = f"WL-{secrets.token_hex(3).upper()}"
    expiry = (datetime.now() + timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")

    cursor.execute("""
    UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?
    """, (token, expiry, user["id"]))
    conn.commit()
    conn.close()

    return jsonify({
        "success": True,
        "message": "Password reset token generated. In a live production environment, this is emailed to the user.",
        "demo_reset_token": token
    })

@app.route("/api/auth/reset-password", methods=["POST"])
def auth_reset_password():
    data = request.get_json() or {}
    token = data.get("token", "").strip().upper()
    new_password = data.get("new_password", "").strip()

    if not token or not new_password:
        return jsonify({"error": "Reset token and new password are required"}), 400
    if len(new_password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    cursor.execute("""
    SELECT id, email FROM users WHERE reset_token = ? AND reset_token_expiry >= ?
    """, (token, now_str))
    user = cursor.fetchone()

    if not user:
        conn.close()
        return jsonify({"error": "Invalid or expired reset token"}), 400

    pwd_hash = generate_password_hash(new_password)
    cursor.execute("""
    UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?
    """, (pwd_hash, user["id"]))
    conn.commit()
    conn.close()

    return jsonify({"success": True, "message": "Password successfully updated. You may now log in."})

@app.route("/api/auth/profile", methods=["POST"])
def auth_update_profile():
    user = get_current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json() or {}
    display_name = data.get("display_name", user["display_name"]).strip()
    title = data.get("title", user["title"]).strip()
    bio = data.get("bio", user["bio"]).strip()
    avatar_url = data.get("avatar_url", user["avatar_url"]).strip()

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE users SET display_name = ?, title = ?, bio = ?, avatar_url = ? WHERE id = ?
    """, (display_name, title, bio, avatar_url, user["id"]))
    conn.commit()

    cursor.execute("SELECT id, email, display_name, avatar_url, title, bio, role, created_at FROM users WHERE id = ?", (user["id"],))
    updated = dict(cursor.fetchone())
    conn.close()

    return jsonify({"success": True, "user": updated, "message": "Profile updated successfully."})

# ============================================================
# 2. ITINERARIES & WAYPOINTS API
# ============================================================
@app.route("/api/trips", methods=["GET"])
def get_trips():
    user = get_current_user()
    user_id = user["id"] if user else 1

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT t.*, COUNT(w.id) as waypoints_count
    FROM trips t
    LEFT JOIN trip_waypoints w ON t.id = w.trip_id
    WHERE t.user_id = ?
    GROUP BY t.id
    ORDER BY t.start_date ASC
    """, (user_id,))
    trips = [dict(r) for r in cursor.fetchall()]

    for t in trips:
        cursor.execute("SELECT * FROM trip_waypoints WHERE trip_id = ? ORDER BY day_number ASC, order_index ASC", (t["id"],))
        t["waypoints"] = [dict(w) for w in cursor.fetchall()]

    conn.close()
    return jsonify(trips)

@app.route("/api/trips", methods=["POST"])
def create_trip():
    user = get_current_user()
    user_id = user["id"] if user else 1

    data = request.get_json() or {}
    title = data.get("title", "").strip()
    destination = data.get("destination", "").strip()
    start_date = data.get("start_date", "").strip()
    end_date = data.get("end_date", "").strip()
    budget = float(data.get("budget", 0.0) or 0.0)
    notes = data.get("notes", "").strip()
    status = data.get("status", "Upcoming").strip()

    if not title or not destination or not start_date:
        return jsonify({"error": "Title, destination, and start date are required"}), 400

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO trips (user_id, title, destination, start_date, end_date, budget, status, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (user_id, title, destination, start_date, end_date or start_date, budget, status, notes, now))
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()

    return jsonify({"success": True, "id": new_id, "message": "Itinerary created successfully!"})

@app.route("/api/trips/<int:trip_id>", methods=["GET", "PUT", "DELETE"])
def trip_detail(trip_id):
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM trips WHERE id = ?", (trip_id,))
    trip_row = cursor.fetchone()
    if not trip_row:
        conn.close()
        return jsonify({"error": "Trip not found"}), 404

    if request.method == "GET":
        trip = dict(trip_row)
        cursor.execute("""
        SELECT w.*, s.name as sanctuary_name, s.image_url as sanctuary_image
        FROM trip_waypoints w
        LEFT JOIN spots s ON w.spot_id = s.id
        WHERE w.trip_id = ?
        ORDER BY w.day_number ASC, w.order_index ASC
        """, (trip_id,))
        trip["waypoints"] = [dict(w) for w in cursor.fetchall()]
        conn.close()
        return jsonify(trip)

    elif request.method == "PUT":
        data = request.get_json() or {}
        title = data.get("title", trip_row["title"]).strip()
        destination = data.get("destination", trip_row["destination"]).strip()
        start_date = data.get("start_date", trip_row["start_date"]).strip()
        end_date = data.get("end_date", trip_row["end_date"]).strip()
        budget = float(data.get("budget", trip_row["budget"]))
        status = data.get("status", trip_row["status"]).strip()
        notes = data.get("notes", trip_row["notes"]).strip()

        cursor.execute("""
        UPDATE trips SET title = ?, destination = ?, start_date = ?, end_date = ?, budget = ?, status = ?, notes = ?
        WHERE id = ?
        """, (title, destination, start_date, end_date, budget, status, notes, trip_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True, "message": "Trip updated successfully."})

    elif request.method == "DELETE":
        cursor.execute("DELETE FROM trips WHERE id = ?", (trip_id,))
        conn.commit()
        conn.close()
        return jsonify({"success": True, "message": "Itinerary deleted."})

@app.route("/api/trips/<int:trip_id>/waypoints", methods=["POST"])
def add_waypoint(trip_id):
    data = request.get_json() or {}
    title = data.get("title", "").strip()
    latitude = float(data.get("latitude", 0.0))
    longitude = float(data.get("longitude", 0.0))
    day_number = int(data.get("day_number", 1))
    notes = data.get("notes", "").strip()
    spot_id = data.get("spot_id")

    if not title or latitude == 0.0 or longitude == 0.0:
        return jsonify({"error": "Title, latitude, and longitude are required"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT MAX(order_index) FROM trip_waypoints WHERE trip_id = ? AND day_number = ?", (trip_id, day_number))
    max_order = cursor.fetchone()[0] or 0

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute("""
    INSERT INTO trip_waypoints (trip_id, spot_id, title, latitude, longitude, day_number, order_index, notes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (trip_id, spot_id, title, latitude, longitude, day_number, max_order + 1, notes, now))
    conn.commit()
    new_id = cursor.lastrowid

    cursor.execute("SELECT * FROM trip_waypoints WHERE id = ?", (new_id,))
    waypoint = dict(cursor.fetchone())
    conn.close()

    return jsonify({"success": True, "waypoint": waypoint, "message": "Waypoint added to itinerary route."})

@app.route("/api/trips/<int:trip_id>/waypoints/<int:waypoint_id>", methods=["DELETE"])
def delete_waypoint(trip_id, waypoint_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM trip_waypoints WHERE id = ? AND trip_id = ?", (waypoint_id, trip_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "Waypoint removed from itinerary."})

# ============================================================
# 3. RESERVATIONS & BOOKINGS API
# ============================================================
@app.route("/api/bookings", methods=["GET"])
def get_bookings():
    user = get_current_user()
    user_id = user["id"] if user else 1

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT r.*, s.name as spot_name, s.region as spot_region, s.image_url as spot_image,
           e.title as expedition_title
    FROM reservations r
    LEFT JOIN spots s ON r.spot_id = s.id
    LEFT JOIN expeditions e ON r.expedition_id = e.id
    WHERE r.user_id = ?
    ORDER BY r.travel_date ASC
    """, (user_id,))
    bookings = [dict(r) for r in cursor.fetchall()]
    conn.close()

    return jsonify(bookings)

@app.route("/api/bookings", methods=["POST"])
def create_booking():
    user = get_current_user()
    user_id = user["id"] if user else 1

    data = request.get_json() or {}
    spot_id = data.get("spot_id")
    expedition_id = data.get("expedition_id")
    booking_type = data.get("booking_type", "Sanctuary Conservation Eco-Permit").strip()
    travel_date = data.get("travel_date", "").strip()
    party_size = int(data.get("party_size", 1))
    total_amount = float(data.get("total_amount", 15.0) or 15.0)
    special_requests = data.get("special_requests", "").strip()

    if not travel_date:
        return jsonify({"error": "Travel date is required"}), 400
    if party_size < 1 or party_size > 8:
        return jsonify({"error": "Group size must be between 1 and 8 to protect sanctuary ecology"}), 400

    ref_num = secrets.randbelow(9000) + 1000
    booking_ref = f"WL-2026-{ref_num}"
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO reservations (
        user_id, spot_id, expedition_id, booking_reference, booking_type,
        travel_date, party_size, total_amount, status, special_requests, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Confirmed', ?, ?)
    """, (user_id, spot_id, expedition_id, booking_ref, booking_type, travel_date, party_size, total_amount, special_requests, now))
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()

    return jsonify({
        "success": True,
        "id": new_id,
        "booking_reference": booking_ref,
        "message": f"Reservation confirmed! Permit #{booking_ref} is now active in your dashboard."
    })

@app.route("/api/bookings/<int:booking_id>/cancel", methods=["POST"])
def cancel_booking(booking_id):
    user = get_current_user()
    user_id = user["id"] if user else 1

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE reservations SET status = 'Cancelled' WHERE id = ? AND user_id = ?", (booking_id, user_id))
    conn.commit()
    conn.close()

    return jsonify({"success": True, "message": "Reservation cancelled successfully."})

# ============================================================
# 4. CONTACT & CONCIERGE API
# ============================================================
@app.route("/api/contact", methods=["POST"])
def submit_contact():
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    email = data.get("email", "").strip()
    subject = data.get("subject", "").strip()
    message = data.get("message", "").strip()

    if not name or not email or not message:
        return jsonify({"error": "Name, email, and message are required"}), 400

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO contact_submissions (name, email, subject, message, status, created_at)
    VALUES (?, ?, ?, ?, 'New', ?)
    """, (name, email, subject or "General Sanctuary Inquiry", message, now))
    conn.commit()
    conn.close()

    return jsonify({
        "success": True,
        "message": "Your inquiry has been submitted to the Sanctuary Concierge. A local guardian will respond shortly."
    })

# ============================================================
# 5. CONFIG & GOOGLE MAPS API KEY PROVIDER
# ============================================================
@app.route("/api/config", methods=["GET"])
def get_config():
    gmaps_key = os.environ.get("GOOGLE_MAPS_API_KEY", "")
    return jsonify({
        "google_maps_configured": bool(gmaps_key and gmaps_key != "YOUR_KEY_HERE"),
        "google_maps_api_key": gmaps_key if gmaps_key != "YOUR_KEY_HERE" else "",
        "environment": "production",
        "fallback_map_engine": "CartoDB Dark Matter / Leaflet"
    })

# ============================================================
# 6. SANCTUARIES & COMMUNITY (EXISTING ENHANCED)
# ============================================================
@app.route("/api/spots", methods=["GET"])
def get_spots():
    query = request.args.get("q", "").strip().lower()
    category = request.args.get("category", "").strip()
    min_solitude = request.args.get("min_solitude", type=int, default=0)
    difficulty = request.args.get("difficulty", "").strip()
    username = request.args.get("username", "purvaj").strip().lower()

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM user_profiles WHERE username = ?", (username,))
    user_row = cursor.fetchone()
    user = dict(user_row) if user_row else {
        "preferred_categories": "Stargazing Sanctuaries, Forgotten Ruins",
        "min_solitude_pref": 85,
        "max_decibel_pref": 20
    }

    cursor.execute("SELECT spot_id FROM user_bookmarks WHERE username = ?", (username,))
    bookmarked_ids = {r["spot_id"] for r in cursor.fetchall()}

    sql = "SELECT * FROM spots WHERE solitude_score >= ?"
    params = [min_solitude]

    if category and category != "All" and category != "Recommended":
        sql += " AND category = ?"
        params.append(category)

    if difficulty and difficulty != "All":
        sql += " AND difficulty LIKE ?"
        params.append(f"%{difficulty}%")

    if query:
        sql += " AND (LOWER(name) LIKE ? OR LOWER(region) LIKE ? OR LOWER(country) LIKE ? OR LOWER(lore) LIKE ?)"
        term = f"%{query}%"
        params.extend([term, term, term, term])

    sql += " ORDER BY solitude_score DESC, upvotes DESC"
    cursor.execute(sql, params)
    rows = cursor.fetchall()

    user_preferred_cats = [c.strip().lower() for c in user.get("preferred_categories", "").split(",")]
    user_min_sol = user.get("min_solitude_pref", 80)
    user_max_db = user.get("max_decibel_pref", 25)

    spots = []
    for r in rows:
        spot = dict(r)
        score = 60
        reasons = []

        if any(cat in spot["category"].lower() for cat in user_preferred_cats):
            score += 25
            reasons.append(f"Matches your favorite {spot['category']} terrain")

        if spot["solitude_score"] >= user_min_sol:
            score += 10
            reasons.append(f"High solitude ({spot['solitude_score']}%) meets your threshold")

        if spot["decibel_level"] <= user_max_db:
            score += 5
            reasons.append(f"Acoustic calm ({spot['decibel_level']} dB) matches quiet preference")

        match_pct = min(99, max(68, score))
        spot["match_percentage"] = match_pct
        spot["match_reason"] = " • ".join(reasons) if reasons else "Untouched peaceful sanctuary"
        spot["is_bookmarked"] = spot["id"] in bookmarked_ids

        if spot["is_protected"]:
            spot["display_lat"] = round(spot["latitude"], 1)
            spot["display_lng"] = round(spot["longitude"], 1)
            spot["exact_unlocked"] = False
        else:
            spot["display_lat"] = spot["latitude"]
            spot["display_lng"] = spot["longitude"]
            spot["exact_unlocked"] = True
        spots.append(spot)

    conn.close()

    if category == "Recommended":
        spots = [s for s in spots if s["match_percentage"] >= 85]
        spots.sort(key=lambda s: s["match_percentage"], reverse=True)

    return jsonify(spots)

@app.route("/api/spots/<int:spot_id>", methods=["GET"])
def get_spot_detail(spot_id):
    username = request.args.get("username", "purvaj").strip().lower()
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM spots WHERE id = ?", (spot_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Spot not found"}), 404

    spot = dict(row)

    cursor.execute(
        "SELECT * FROM field_notes WHERE spot_id = ? ORDER BY upvotes DESC, created_at DESC",
        (spot_id,)
    )
    notes = [dict(n) for n in cursor.fetchall()]
    spot["notes"] = notes

    cursor.execute(
        "SELECT personal_note FROM user_bookmarks WHERE username = ? AND spot_id = ?",
        (username, spot_id)
    )
    bookmark_row = cursor.fetchone()
    spot["is_bookmarked"] = bookmark_row is not None
    spot["personal_note"] = bookmark_row["personal_note"] if bookmark_row else ""

    conn.close()
    return jsonify(spot)

@app.route("/api/spots/<int:spot_id>/unlock", methods=["POST"])
def unlock_spot_coordinates(spot_id):
    data = request.get_json() or {}
    user_answer = data.get("answer", "").strip().lower()

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, latitude, longitude, riddle_answer, riddle_hint FROM spots WHERE id = ?", (spot_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Spot not found"}), 404

    target_answer = row["riddle_answer"].strip().lower()
    if user_answer and (user_answer in target_answer or target_answer in user_answer):
        conn.close()
        return jsonify({
            "success": True,
            "message": "Ancient riddle solved! Exact coordinates unlocked.",
            "latitude": row["latitude"],
            "longitude": row["longitude"],
            "spot_id": spot_id
        })
    else:
        conn.close()
        return jsonify({
            "success": False,
            "message": "The guardian whispers that your answer does not align with the lore.",
            "hint": row["riddle_hint"]
        }), 400

@app.route("/api/spots/<int:spot_id>/upvote", methods=["POST"])
def upvote_spot(spot_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE spots SET upvotes = upvotes + 1 WHERE id = ?", (spot_id,))
    conn.commit()
    cursor.execute("SELECT upvotes FROM spots WHERE id = ?", (spot_id,))
    new_votes = cursor.fetchone()["upvotes"]
    conn.close()
    return jsonify({"success": True, "upvotes": new_votes})

@app.route("/api/spots/<int:spot_id>/notes", methods=["POST"])
def add_field_note(spot_id):
    data = request.get_json() or {}
    author_name = data.get("author_name", "Trail Wanderer").strip()
    author_badge = data.get("author_badge", "Explorer").strip()
    note_type = data.get("note_type", "Trail Alert").strip()
    content = data.get("content", "").strip()

    if not content:
        return jsonify({"error": "Note content cannot be empty"}), 400

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO field_notes (spot_id, author_name, author_badge, note_type, content, upvotes, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
    """, (spot_id, author_name, author_badge, note_type, content, now))
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()

    return jsonify({
        "success": True,
        "note": {
            "id": new_id,
            "spot_id": spot_id,
            "author_name": author_name,
            "author_badge": author_badge,
            "note_type": note_type,
            "content": content,
            "upvotes": 0,
            "created_at": now
        }
    })

@app.route("/api/notes/<int:note_id>/upvote", methods=["POST"])
def upvote_note(note_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE field_notes SET upvotes = upvotes + 1 WHERE id = ?", (note_id,))
    conn.commit()
    cursor.execute("SELECT upvotes FROM field_notes WHERE id = ?", (note_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return jsonify({"success": True, "upvotes": row["upvotes"]})
    return jsonify({"error": "Note not found"}), 404

@app.route("/api/spots", methods=["POST"])
def create_spot():
    data = request.get_json() or {}
    name = data.get("name", "").strip()
    tagline = data.get("tagline", "").strip()
    region = data.get("region", "").strip()
    country = data.get("country", "").strip()
    category = data.get("category", "Forgotten Ruins").strip()
    latitude = float(data.get("latitude", 0.0))
    longitude = float(data.get("longitude", 0.0))
    image_url = data.get("image_url", "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80").strip()
    lore = data.get("lore", "").strip()
    solitude_score = int(data.get("solitude_score", 85))
    decibel_level = int(data.get("decibel_level", 20))
    crowd_factor = data.get("crowd_factor", "Under 5 visitors per month").strip()
    cell_signal = data.get("cell_signal", "0 Bars - Pure Wilderness").strip()
    difficulty = data.get("difficulty", "Moderate Trail").strip()
    best_season = data.get("best_season", "Year-round").strip()
    leave_no_trace_notes = data.get("leave_no_trace_notes", "Leave no trace. Pack out all waste.").strip()
    guardian_name = data.get("guardian_name", "Local Community").strip()
    guardian_title = data.get("guardian_title", "Sanctuary Guardian").strip()
    is_protected = 1 if data.get("is_protected") else 0
    riddle_question = data.get("riddle_question", "").strip()
    riddle_answer = data.get("riddle_answer", "").strip()
    riddle_hint = data.get("riddle_hint", "").strip()
    soundscape_type = data.get("soundscape_type", "forest_wind").strip()
    permit_price = float(data.get("permit_price", 15.0) or 15.0)

    if not name or not region or not lore:
        return jsonify({"error": "Name, region, and lore are required"}), 400

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO spots (
        name, tagline, region, country, category, latitude, longitude, image_url, lore,
        solitude_score, decibel_level, crowd_factor, cell_signal, difficulty, best_season,
        leave_no_trace_notes, guardian_name, guardian_title, riddle_question, riddle_answer,
        riddle_hint, is_protected, soundscape_type, upvotes, permit_price, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    """, (
        name, tagline, region, country, category, latitude, longitude, image_url, lore,
        solitude_score, decibel_level, crowd_factor, cell_signal, difficulty, best_season,
        leave_no_trace_notes, guardian_name, guardian_title, riddle_question, riddle_answer,
        riddle_hint, is_protected, soundscape_type, permit_price, now
    ))
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()

    return jsonify({"success": True, "id": new_id})

@app.route("/api/personas", methods=["GET"])
def get_personas():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM user_profiles ORDER BY id ASC")
    rows = cursor.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/api/profile", methods=["GET", "POST"])
def user_profile():
    conn = get_db_connection()
    cursor = conn.cursor()

    if request.method == "GET":
        username = request.args.get("username", "purvaj").strip().lower()
        cursor.execute("SELECT * FROM user_profiles WHERE username = ?", (username,))
        row = cursor.fetchone()
        conn.close()
        if not row:
            return jsonify({"error": "Profile not found"}), 404
        return jsonify(dict(row))

    elif request.method == "POST":
        data = request.get_json() or {}
        username = data.get("username", "purvaj").strip().lower()
        display_name = data.get("display_name", "Purvaj").strip()
        title = data.get("title", "Astro-Backpacker").strip()
        bio = data.get("bio", "").strip()
        preferred_categories = data.get("preferred_categories", "Stargazing Sanctuaries, Forgotten Ruins").strip()
        min_solitude = int(data.get("min_solitude_pref", 85))
        max_decibel = int(data.get("max_decibel_pref", 20))

        cursor.execute("""
        UPDATE user_profiles
        SET display_name = ?, title = ?, bio = ?, preferred_categories = ?,
            min_solitude_pref = ?, max_decibel_pref = ?
        WHERE username = ?
        """, (display_name, title, bio, preferred_categories, min_solitude, max_decibel, username))
        conn.commit()

        cursor.execute("SELECT * FROM user_profiles WHERE username = ?", (username,))
        updated = dict(cursor.fetchone())
        conn.close()
        return jsonify({"success": True, "profile": updated})

@app.route("/api/bookmarks", methods=["GET"])
def get_bookmarks():
    username = request.args.get("username", "purvaj").strip().lower()
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT s.*, b.personal_note, b.created_at AS bookmarked_at
    FROM spots s
    JOIN user_bookmarks b ON s.id = b.spot_id
    WHERE b.username = ?
    ORDER BY b.created_at DESC
    """, (username,))
    rows = cursor.fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

@app.route("/api/bookmarks/toggle", methods=["POST"])
def toggle_bookmark():
    data = request.get_json() or {}
    username = data.get("username", "purvaj").strip().lower()
    spot_id = int(data.get("spot_id", 0))
    personal_note = data.get("personal_note", "").strip()

    if not spot_id:
        return jsonify({"error": "spot_id is required"}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM user_bookmarks WHERE username = ? AND spot_id = ?", (username, spot_id))
    existing = cursor.fetchone()

    if existing:
        cursor.execute("DELETE FROM user_bookmarks WHERE username = ? AND spot_id = ?", (username, spot_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True, "is_bookmarked": False, "message": "Sanctuary removed from your journey."})
    else:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute("""
        INSERT INTO user_bookmarks (username, spot_id, personal_note, created_at)
        VALUES (?, ?, ?, ?)
        """, (username, spot_id, personal_note, now))
        conn.commit()
        conn.close()
        return jsonify({"success": True, "is_bookmarked": True, "message": "Sanctuary saved to your journey ledger!"})

@app.route("/api/bookmarks/<int:spot_id>/note", methods=["POST"])
def update_bookmark_note(spot_id):
    data = request.get_json() or {}
    username = data.get("username", "purvaj").strip().lower()
    personal_note = data.get("personal_note", "").strip()

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE user_bookmarks SET personal_note = ? WHERE username = ? AND spot_id = ?
    """, (personal_note, username, spot_id))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "personal_note": personal_note})

@app.route("/api/expeditions", methods=["GET"])
def get_expeditions():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM expeditions ORDER BY created_at DESC")
    expeditions = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return jsonify(expeditions)

@app.route("/api/expeditions", methods=["POST"])
def create_expedition():
    data = request.get_json() or {}
    title = data.get("title", "").strip()
    destination_name = data.get("destination_name", "").strip()
    region = data.get("region", "").strip()
    organizer_name = data.get("organizer_name", "Trail Wanderer").strip()
    organizer_badge = data.get("organizer_badge", "Pathfinder").strip()
    expedition_date = data.get("expedition_date", "").strip()
    skill_level = data.get("skill_level", "Moderate Hiker").strip()
    max_participants = int(data.get("max_participants", 5))
    description = data.get("description", "").strip()

    if not title or not destination_name or not expedition_date:
        return jsonify({"error": "Missing required fields"}), 400

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO expeditions (
        title, destination_name, region, organizer_name, organizer_badge,
        expedition_date, skill_level, max_participants, current_participants,
        description, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    """, (title, destination_name, region, organizer_name, organizer_badge,
          expedition_date, skill_level, max_participants, description, now))
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()

    return jsonify({"success": True, "id": new_id})

@app.route("/api/expeditions/<int:exp_id>/join", methods=["POST"])
def join_expedition(exp_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT current_participants, max_participants FROM expeditions WHERE id = ?", (exp_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return jsonify({"error": "Expedition not found"}), 404

    if row["current_participants"] >= row["max_participants"]:
        conn.close()
        return jsonify({"error": "Expedition roster is full to prevent environmental impact"}), 400

    cursor.execute("UPDATE expeditions SET current_participants = current_participants + 1 WHERE id = ?", (exp_id,))
    conn.commit()
    new_count = row["current_participants"] + 1
    conn.close()

    return jsonify({"success": True, "current_participants": new_count})

@app.route("/api/discussions", methods=["GET", "POST"])
def discussions():
    conn = get_db_connection()
    cursor = conn.cursor()

    if request.method == "GET":
        cursor.execute("SELECT * FROM community_discussions ORDER BY created_at DESC")
        threads = [dict(r) for r in cursor.fetchall()]
        conn.close()
        return jsonify(threads)

    elif request.method == "POST":
        data = request.get_json() or {}
        title = data.get("title", "").strip()
        author_name = data.get("author_name", "Explorer").strip()
        author_badge = data.get("author_badge", "Pathfinder").strip()
        category = data.get("category", "General Discussion").strip()
        content = data.get("content", "").strip()

        if not title or not content:
            conn.close()
            return jsonify({"error": "Title and content required"}), 400

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        cursor.execute("""
        INSERT INTO community_discussions (title, author_name, author_badge, category, content, replies_count, upvotes, created_at)
        VALUES (?, ?, ?, ?, ?, 0, 1, ?)
        """, (title, author_name, author_badge, category, content, now))
        conn.commit()
        new_id = cursor.lastrowid
        conn.close()

        return jsonify({"success": True, "id": new_id})

@app.route("/api/discussions/<int:disc_id>/upvote", methods=["POST"])
def upvote_discussion(disc_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE community_discussions SET upvotes = upvotes + 1 WHERE id = ?", (disc_id,))
    conn.commit()
    cursor.execute("SELECT upvotes FROM community_discussions WHERE id = ?", (disc_id,))
    new_votes = cursor.fetchone()["upvotes"]
    conn.close()
    return jsonify({"success": True, "upvotes": new_votes})

@app.route("/api/stats", methods=["GET"])
def get_stats():
    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*), AVG(solitude_score), AVG(decibel_level) FROM spots")
    spot_count, avg_solitude, avg_decibel = cursor.fetchone()

    cursor.execute("SELECT COUNT(*) FROM field_notes")
    note_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM expeditions")
    expedition_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM user_bookmarks")
    bookmark_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM trips")
    trip_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM reservations WHERE status = 'Confirmed'")
    booking_count = cursor.fetchone()[0]

    conn.close()

    return jsonify({
        "total_sanctuaries": spot_count,
        "avg_solitude_score": round(avg_solitude or 90, 1),
        "avg_decibel_level": round(avg_decibel or 18, 1),
        "community_field_notes": note_count,
        "active_expeditions": expedition_count,
        "saved_journeys": bookmark_count,
        "active_itineraries": trip_count,
        "confirmed_permits": booking_count
    })

if __name__ == "__main__":
    print("Starting WanderLore Production Server on http://127.0.0.1:5000")
    app.run(host="0.0.0.0", port=5000, debug=True)
