import os
import sqlite3
import uuid
import time
import math
from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO
from flask_cors import CORS
from werkzeug.utils import secure_filename

app = Flask(__name__, static_folder='public', static_url_path='')
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

UPLOAD_FOLDER = 'public/uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# --- DB INIT ---
DB_FILE = 'sahayata.db'

def calculate_distance(lat1, lon1, lat2, lon2):
    if not all([lat1, lon1, lat2, lon2]): return None
    try:
        lat1, lon1, lat2, lon2 = map(float, [lat1, lon1, lat2, lon2])
    except ValueError:
        return None
    R = 6371 # Radius of earth in km
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = math.sin(dLat/2) * math.sin(dLat/2) + \
        math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * \
        math.sin(dLon/2) * math.sin(dLon/2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return round(R * c, 2)

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()
    # Users table (donors, ngos, admins, farmers)
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE,
        phone TEXT,
        capacity TEXT,
        location TEXT,
        password TEXT,
        lat TEXT,
        lng TEXT,
        joined_at INTEGER,
        role TEXT,
        impact_score REAL DEFAULT 0.0
    )''')
    
    # Try adding impact_score column if it doesn't exist (for seamless migrations)
    try:
        c.execute("ALTER TABLE users ADD COLUMN impact_score REAL DEFAULT 0.0")
    except sqlite3.OperationalError:
        pass
    
    # Needs admin?
    c.execute("SELECT id FROM users WHERE role='admin'")
    if not c.fetchone():
        c.execute("INSERT OR IGNORE INTO users (id, name, password, role) VALUES (?, ?, ?, ?)", ("admin-1", "admin@123", "fusionhacks", "admin"))
    
    c.execute('''CREATE TABLE IF NOT EXISTS food_listings (
        id TEXT PRIMARY KEY,
        donor_id TEXT,
        food_type TEXT,
        quantity TEXT,
        expiry_time TEXT,
        location TEXT,
        auto_accept INTEGER,
        status TEXT,
        diet_type TEXT,
        category TEXT,
        image_url TEXT,
        is_compost INTEGER DEFAULT 0
    )''')
    
    try:
        c.execute("ALTER TABLE food_listings ADD COLUMN is_compost INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    
    c.execute('''CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        ngo_id TEXT,
        food_id TEXT,
        status TEXT
    )''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS ratings (
        id TEXT PRIMARY KEY,
        from_user_id TEXT,
        to_user_id TEXT,
        listing_id TEXT,
        rating INTEGER,
        comment TEXT
    )''')
    
    c.execute('''CREATE TABLE IF NOT EXISTS ngo_requirements (
        id TEXT PRIMARY KEY,
        ngo_id TEXT,
        ngo_name TEXT,
        title TEXT,
        quantity TEXT,
        urgency TEXT,
        timestamp INTEGER
    )''')
    conn.commit()
    conn.close()

init_db()

# --- STATIC ROUTING ---
@app.route('/')
def serve_index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    if os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    return "Not Found", 404

# --- AUTHENTICATION ---
@app.route('/api/register', methods=['POST'])
def register():
    content = request.json
    role = content.get('role')
    name = content.get('name')
    
    conn = get_db()
    c = conn.cursor()
    
    c.execute("SELECT id FROM users WHERE name=? AND role=?", (name, role))
    if c.fetchone():
        conn.close()
        return jsonify({"error": f"{role.capitalize()} Name exists"}), 400
        
    user_id = str(uuid.uuid4())
    joined_at = int(time.time())
    
    if role == 'donor':
        c.execute("INSERT INTO users (id, name, phone, password, lat, lng, joined_at, role, impact_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                  (user_id, name, content.get('phone'), content.get('password'), content.get('lat'), content.get('lng'), joined_at, role, 0.0))
    elif role in ['ngo', 'farmer']:
        c.execute("INSERT INTO users (id, name, capacity, location, password, lat, lng, joined_at, role, impact_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                  (user_id, name, content.get('capacity'), content.get('location'), content.get('password'), content.get('lat'), content.get('lng'), joined_at, role, 0.0))
    else:
        conn.close()
        return jsonify({"error": "Invalid role"}), 400
        
    conn.commit()
    conn.close()
    
    user_out = {
        "id": user_id, "name": name, "lat": content.get('lat'), "lng": content.get('lng'),
        "joined_at": joined_at, "role": role, "impact_score": 0.0
    }
    if role == 'donor': user_out['phone'] = content.get('phone')
    if role in ['ngo', 'farmer']: 
        user_out['capacity'] = content.get('capacity')
        user_out['location'] = content.get('location')
        
    return jsonify(user_out), 201

@app.route('/api/login', methods=['POST'])
def login():
    content = request.json
    name = content.get('name')
    password = content.get('password')
    
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM users WHERE name=? AND password=?", (name, password))
    user = c.fetchone()
    conn.close()
    
    if user:
        user_out = dict(user)
        del user_out['password']
        return jsonify(user_out), 200
    return jsonify({"error": "Invalid credentials"}), 401

# --- CORE LOGIC ---
@app.route('/api/listings', methods=['POST'])
def add_listing():
    content = request.json
    listing_id = str(uuid.uuid4())
    
    conn = get_db()
    c = conn.cursor()
    c.execute('''INSERT INTO food_listings 
                 (id, donor_id, food_type, quantity, expiry_time, location, auto_accept, status, diet_type, category, image_url, is_compost) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
              (listing_id, content.get('donor_id'), content.get('food_type'), content.get('quantity'), 
               content.get('expiry_time'), content.get('location'), 1 if content.get('auto_accept') else 0, 
               'available', content.get('diet_type', 'veg'), content.get('category', 'Cooked Meals'), content.get('image_url'), 1 if content.get('is_compost') else 0))
    conn.commit()
    conn.close()
    
    socketio.emit('listing_updated')
    return jsonify({"success": True, "id": listing_id}), 201

@app.route('/api/listings', methods=['GET'])
def get_listings():
    user_id = request.args.get('user_id')
    role = request.args.get('role')
    
    conn = get_db()
    c = conn.cursor()
    
    c.execute("SELECT * FROM food_listings")
    raw_listings = [dict(row) for row in c.fetchall()]
    
    c.execute("SELECT * FROM users")
    users = {row['id']: dict(row) for row in c.fetchall()}
    
    c.execute("SELECT * FROM requests")
    requests_data = [dict(row) for row in c.fetchall()]
    
    enriched = []
    
    for l in raw_listings:
        donor = users.get(l['donor_id'])
        if donor:
            l['donor_name'] = donor['name']
            l['lat'] = donor.get('lat')
            l['lng'] = donor.get('lng')
            
        current_user = users.get(user_id)
        if current_user and donor:
            dist = calculate_distance(donor.get('lat'), donor.get('lng'), current_user.get('lat'), current_user.get('lng'))
            if dist is not None:
                l['distance_km'] = dist
                # roughly avg 0.12kg CO2 per km for a small delivery vehicle
                l['transport_co2'] = round(dist * 0.12, 2)
            
        l['auto_accept'] = bool(l['auto_accept'])
            
        if role == 'donor' and l['donor_id'] != user_id:
            continue
        
        is_l_compost = bool(l.get('is_compost'))
        
        if role == 'ngo':
            if is_l_compost: continue # NGOs don't see compost
            if l['status'] not in ['available', 'claimed', 'completed']: continue
            if l['status'] in ['claimed', 'completed']:
                my_reqs = [r for r in requests_data if r['food_id'] == l['id'] and r['ngo_id'] == user_id and r['status'] == 'accepted']
                if not my_reqs:
                    continue
        
        if role == 'farmer':
            if not is_l_compost: continue # Farmers only see compost
            if l['status'] not in ['available', 'claimed', 'completed']: continue
            if l['status'] in ['claimed', 'completed']:
                my_reqs = [r for r in requests_data if r['food_id'] == l['id'] and r['ngo_id'] == user_id and r['status'] == 'accepted']
                if not my_reqs:
                    continue
                    
        if l['status'] == 'available' and role == 'donor' and user_id == l['donor_id']:
            l['pending_requests'] = []
            for req in requests_data:
                if req['food_id'] == l['id'] and req['status'] == 'pending':
                    ngo = users.get(req['ngo_id'], {})
                    l['pending_requests'].append({
                        "request_id": req['id'], "ngo_id": req['ngo_id'],
                        "name": ngo.get('name'), "capacity": ngo.get('capacity'), "location": ngo.get('location')
                    })
                    
        if l['status'] == 'available' and role in ['ngo', 'farmer']:
            for req in requests_data:
                if req['food_id'] == l['id'] and req['ngo_id'] == user_id and req['status'] == 'pending':
                    l['ngo_has_pending'] = True
                    
        if l['status'] in ['claimed', 'completed']:
            for req in requests_data:
                if req['food_id'] == l['id'] and req['status'] == 'accepted':
                    l['claimed_by_ngo_id'] = req['ngo_id']
                    ngo = users.get(req['ngo_id'])
                    if ngo:
                        l['ngo_name'] = ngo['name']
                    
                    if (role == 'donor' and user_id == l['donor_id']) or (role in ['ngo', 'farmer'] and user_id == req['ngo_id']):
                        if donor:
                            l['donor_contact'] = {"phone": donor.get('phone')}
                        if ngo:
                            l['ngo_contact'] = {"location": ngo.get('location'), "capacity": ngo.get('capacity')}
        
        enriched.append(l)
        
    conn.close()
    return jsonify(enriched)

@app.route('/api/listings/<listing_id>/request', methods=['POST'])
def request_listing(listing_id):
    content = request.json
    ngo_id = content.get("ngo_id")
    
    conn = get_db()
    c = conn.cursor()
    
    c.execute("SELECT * FROM food_listings WHERE id=? AND status='available'", (listing_id,))
    target = c.fetchone()
    if not target:
        conn.close()
        return jsonify({"error": "Listing not available"}), 400
        
    auto_accept = bool(target['auto_accept'])
    req_status = 'accepted' if auto_accept else 'pending'
    
    if auto_accept:
        c.execute("UPDATE food_listings SET status='claimed' WHERE id=?", (listing_id,))
        
    c.execute("INSERT INTO requests (id, ngo_id, food_id, status) VALUES (?, ?, ?, ?)",
              (str(uuid.uuid4()), ngo_id, listing_id, req_status))
              
    conn.commit()
    conn.close()
    
    socketio.emit('listing_updated')
    return jsonify({"success": True, "status": req_status}), 200

@app.route('/api/listings/<listing_id>/approve', methods=['POST'])
def approve_request(listing_id):
    request_id = request.json.get("request_id")
    conn = get_db()
    c = conn.cursor()
    
    c.execute("UPDATE food_listings SET status='claimed' WHERE id=?", (listing_id,))
    c.execute("UPDATE requests SET status='rejected' WHERE food_id=? AND status='pending'", (listing_id,))
    c.execute("UPDATE requests SET status='accepted' WHERE id=?", (request_id,))
    
    conn.commit()
    conn.close()
    
    socketio.emit('listing_updated')
    return jsonify({"success": True}), 200

@app.route('/api/listings/<listing_id>/complete', methods=['POST'])
def complete_listing(listing_id):
    conn = get_db()
    c = conn.cursor()
    
    # Fetch listing and accepted request to distribute carbon impact points
    c.execute("SELECT donor_id, is_compost FROM food_listings WHERE id=?", (listing_id,))
    listing = c.fetchone()
    
    c.execute("SELECT ngo_id FROM requests WHERE food_id=? AND status='accepted'", (listing_id,))
    req = c.fetchone()
    
    c.execute("UPDATE food_listings SET status='completed' WHERE id=? AND status='claimed'", (listing_id,))
    success = c.rowcount > 0
    
    if success and listing and req:
        donor_id = listing['donor_id']
        claimer_id = req['ngo_id']
        
        # Calculate impact. Normal rescued food = 2.5kg CO2 offset. Compost = 1.2kg CO2 offset.
        offset_value = 1.2 if listing['is_compost'] else 2.5
        
        c.execute("UPDATE users SET impact_score = impact_score + ? WHERE id=?", (offset_value, donor_id))
        c.execute("UPDATE users SET impact_score = impact_score + ? WHERE id=?", (offset_value, claimer_id))
        
    conn.commit()
    conn.close()
    
    if success:
        socketio.emit('listing_updated')
        # Notify clients to fetch new impact profile stats
        socketio.emit('impact_updated')
        return jsonify({"success": True}), 200
    return jsonify({"error": "Failed to complete"}), 400

@app.route('/api/stats', methods=['GET'])
def get_stats():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM food_listings WHERE status='completed'")
    r = c.fetchone()
    completed_count = r[0] if r else 0
    c.execute("SELECT COUNT(*) FROM users WHERE role='ngo'")
    r = c.fetchone()
    ngo_count = r[0] if r else 0
    conn.close()
    return jsonify({"meals_saved": completed_count, "active_ngos": ngo_count})

@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files: return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    if file.filename == '': return jsonify({"error": "No selected file"}), 400
    if file and allowed_file(file.filename):
        filename = secure_filename(f"{int(time.time())}_{file.filename}")
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        return jsonify({"image_url": f"uploads/{filename}"}), 201
    return jsonify({"error": "File type not allowed"}), 400

@app.route('/api/ratings', methods=['POST'])
def submit_rating():
    content = request.json
    conn = get_db()
    c = conn.cursor()
    c.execute("INSERT INTO ratings (id, from_user_id, to_user_id, listing_id, rating, comment) VALUES (?, ?, ?, ?, ?, ?)",
              (str(uuid.uuid4()), content.get('from_user_id'), content.get('to_user_id'), content.get('listing_id'), content.get('rating'), content.get('comment', '')))
    conn.commit()
    conn.close()
    return jsonify({"success": True}), 201

@app.route('/api/ratings/<to_user_id>', methods=['GET'])
def get_user_ratings(to_user_id):
    conn = get_db()
    c = conn.cursor()
    
    c.execute("SELECT * FROM ratings WHERE to_user_id=?", (to_user_id,))
    reviews = [dict(row) for row in c.fetchall()]
    
    avg = sum(r['rating'] for r in reviews) / len(reviews) if reviews else 0
    
    c.execute("SELECT joined_at, impact_score FROM users WHERE id=?", (to_user_id,))
    user = c.fetchone()
    joined_at = user['joined_at'] if user else None
    impact_score = user['impact_score'] if user else 0.0
    
    conn.close()
    
    return jsonify({
        "average": round(avg, 1),
        "count": len(reviews),
        "reviews": reviews,
        "joined_at": joined_at,
        "impact_score": round(impact_score, 1)
    })

@app.route('/api/ngo/requirements', methods=['GET', 'POST'])
def ngo_requirements():
    conn = get_db()
    c = conn.cursor()
    
    if request.method == 'POST':
        content = request.json
        req_id = str(uuid.uuid4())
        ts = int(time.time())
        c.execute("INSERT INTO ngo_requirements (id, ngo_id, ngo_name, title, quantity, urgency, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
                  (req_id, content.get('ngo_id'), content.get('ngo_name'), content.get('title'), content.get('quantity'), content.get('urgency', 'Normal'), ts))
        conn.commit()
        conn.close()
        
        socketio.emit('requirement_updated')
        return jsonify({"id": req_id, "ngo_id": content.get('ngo_id'), "ngo_name": content.get('ngo_name'), 
                        "title": content.get('title'), "quantity": content.get('quantity'), 
                        "urgency": content.get('urgency', 'Normal'), "timestamp": ts}), 201
    else:
        c.execute("SELECT * FROM ngo_requirements ORDER BY timestamp DESC")
        reqs = [dict(row) for row in c.fetchall()]
        conn.close()
        return jsonify(reqs)

@app.route('/api/ngo/requirements/<req_id>', methods=['DELETE'])
def delete_ngo_requirement(req_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM ngo_requirements WHERE id=?", (req_id,))
    conn.commit()
    conn.close()
    return jsonify({"success": True}), 200

# --- ADMIN ENDPOINTS ---
@app.route('/api/admin/overview', methods=['GET'])
def admin_overview():
    conn = get_db()
    c = conn.cursor()
    data = {}
    for table in ['users', 'food_listings', 'requests', 'ratings', 'ngo_requirements']:
        c.execute(f"SELECT * FROM {table}")
        data[table] = [dict(row) for row in c.fetchall()]
        
    data['donors'] = [u for u in data['users'] if u['role'] == 'donor']
    data['ngos'] = [u for u in data['users'] if u['role'] == 'ngo']
    data['admins'] = [u for u in data['users'] if u['role'] == 'admin']
    
    conn.close()
    return jsonify(data)

@app.route('/api/admin/delete-listing/<listing_id>', methods=['DELETE'])
def admin_delete_listing(listing_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM food_listings WHERE id=?", (listing_id,))
    c.execute("DELETE FROM requests WHERE food_id=?", (listing_id,))
    conn.commit()
    conn.close()
    socketio.emit('listing_updated')
    return jsonify({"success": True}), 200

@app.route('/api/admin/delete-user/<role>/<user_id>', methods=['DELETE'])
def admin_delete_user(role, user_id):
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM users WHERE id=? AND role=?", (user_id, role))
    if role == 'donor':
        c.execute("DELETE FROM food_listings WHERE donor_id=?", (user_id,))
    elif role == 'ngo':
        c.execute("DELETE FROM requests WHERE ngo_id=?", (user_id,))
    conn.commit()
    conn.close()
    socketio.emit('listing_updated')
    return jsonify({"success": True}), 200

if __name__ == '__main__':
    init_db()
    socketio.run(app, debug=True, port=5000, allow_unsafe_werkzeug=True)
