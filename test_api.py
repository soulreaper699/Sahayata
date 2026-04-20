import requests
import json

base_url = 'http://127.0.0.1:5000/api'

print('1. Testing Registration...')
donor_res = requests.post(f'{base_url}/register', json={
    'role': 'donor', 'name': 'Green Bakery', 'phone': '555-0101', 'password': 'test', 'lat': '40', 'lng': '-73'
})
print('Donor registration:', donor_res.status_code, donor_res.json())

ngo_res = requests.post(f'{base_url}/register', json={
    'role': 'ngo', 'name': 'Hope Shelter', 'capacity': '50', 'location': 'Downtown', 'password': 'test', 'lat': '40.1', 'lng': '-73.1'
})
print('NGO registration:', ngo_res.status_code, ngo_res.json())

print('\n2. Testing Login...')
login_res = requests.post(f'{base_url}/login', json={'name': 'Green Bakery', 'password': 'test'})
d_id = login_res.json().get('id')
print('Donor login:', login_res.status_code, login_res.json())

print('\n3. Testing Listing Creation...')
listing_data = {
    'donor_id': d_id,
    'food_type': 'Fresh Bread',
    'quantity': '20 loaves',
    'expiry_time': '2027-12-31T23:59',
    'location': 'Bakery Shop',
    'auto_accept': True,
    'diet_type': 'veg',
    'category': 'Baked Goods'
}
list_res = requests.post(f'{base_url}/listings', json=listing_data)
listing_id = list_res.json().get('id')
print('Create listing:', list_res.status_code, list_res.json())

print('\n4. Testing GET Listings (NGO View)...')
ngo_id = ngo_res.json().get('id')
view_res = requests.get(f'{base_url}/listings?user_id={ngo_id}&role=ngo')
print('View listings:', view_res.status_code, len(view_res.json()), 'found')

print('\n5. Testing Request Listing (NGO claims food)...')
req_res = requests.post(f'{base_url}/listings/{listing_id}/request', json={'ngo_id': ngo_id})
print('Request listing:', req_res.status_code, req_res.json())

print('\n6. Checking Admin Overview...')
admin_res = requests.get(f'{base_url}/admin/overview')
print('Admin Overview (Donors):', len(admin_res.json().get('donors', [])))

