import unittest
import json
from app import app
from database import init_db

class ProductionUpgradeTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()
        init_db(force_reseed=True)

    def test_01_index_and_config(self):
        # Index returns 200 and luxury headers
        res = self.client.get('/')
        self.assertEqual(res.status_code, 200)
        self.assertIn(b'WANDERLORE', res.data)

        # Config endpoint returns map engine status
        res_cfg = self.client.get('/api/config')
        self.assertEqual(res_cfg.status_code, 200)
        cfg = json.loads(res_cfg.data)
        self.assertIn('fallback_map_engine', cfg)

    def test_02_auth_lifecycle(self):
        # 1. Login with demo user
        login_res = self.client.post('/api/auth/login', json={
            'email': 'purvaj@wanderlore.com',
            'password': 'password123'
        })
        self.assertEqual(login_res.status_code, 200)
        login_data = json.loads(login_res.data)
        self.assertTrue(login_data['success'])
        self.assertEqual(login_data['user']['display_name'], 'Purvaj')

        # 2. Check current authenticated user
        me_res = self.client.get('/api/auth/me')
        self.assertEqual(me_res.status_code, 200)
        me_data = json.loads(me_res.data)
        self.assertTrue(me_data['authenticated'])
        self.assertEqual(me_data['user']['email'], 'purvaj@wanderlore.com')

        # 3. Register a new user
        reg_res = self.client.post('/api/auth/register', json={
            'display_name': 'Claire Voyage',
            'email': 'claire@wanderlore.com',
            'password': 'safePassword2026'
        })
        self.assertEqual(reg_res.status_code, 200)
        reg_data = json.loads(reg_res.data)
        self.assertTrue(reg_data['success'])

        # 4. Invalidate session via logout
        logout_res = self.client.post('/api/auth/logout')
        self.assertEqual(logout_res.status_code, 200)

    def test_03_password_reset_flow(self):
        # Request reset token
        forgot_res = self.client.post('/api/auth/forgot-password', json={
            'email': 'purvaj@wanderlore.com'
        })
        self.assertEqual(forgot_res.status_code, 200)
        forgot_data = json.loads(forgot_res.data)
        token = forgot_data['demo_reset_token']
        self.assertTrue(token.startswith('WL-'))

        # Reset password using token
        reset_res = self.client.post('/api/auth/reset-password', json={
            'token': token,
            'new_password': 'newSecretPassword2026'
        })
        self.assertEqual(reset_res.status_code, 200)

        # Verify login with new password
        new_login = self.client.post('/api/auth/login', json={
            'email': 'purvaj@wanderlore.com',
            'password': 'newSecretPassword2026'
        })
        self.assertEqual(new_login.status_code, 200)

    def test_04_itinerary_and_waypoints_crud(self):
        # Create Trip
        trip_res = self.client.post('/api/trips', json={
            'title': 'High Atlas Monastic Trek',
            'destination': 'Morocco High Atlas',
            'start_date': '2026-12-01',
            'end_date': '2026-12-06',
            'budget': 800.0,
            'notes': 'Pack winter bivouac and water filter.'
        })
        self.assertEqual(trip_res.status_code, 200)
        trip_id = json.loads(trip_res.data)['id']

        # Add Waypoint 1
        wp1_res = self.client.post(f'/api/trips/{trip_id}/waypoints', json={
            'title': 'Imlil Mule Station',
            'latitude': 31.1356,
            'longitude': -7.9213,
            'day_number': 1,
            'notes': 'Rendezvous with Berber guide'
        })
        self.assertEqual(wp1_res.status_code, 200)
        wp1_id = json.loads(wp1_res.data)['waypoint']['id']

        # Add Waypoint 2
        wp2_res = self.client.post(f'/api/trips/{trip_id}/waypoints', json={
            'title': 'Toubkal Silent Refuge',
            'latitude': 31.0601,
            'longitude': -7.9150,
            'day_number': 2,
            'notes': 'High altitude stone refuge'
        })
        self.assertEqual(wp2_res.status_code, 200)

        # Get full itinerary with waypoints
        get_res = self.client.get(f'/api/trips/{trip_id}')
        self.assertEqual(get_res.status_code, 200)
        trip_data = json.loads(get_res.data)
        self.assertEqual(len(trip_data['waypoints']), 2)

        # Delete Waypoint 1
        del_wp = self.client.delete(f'/api/trips/{trip_id}/waypoints/{wp1_id}')
        self.assertEqual(del_wp.status_code, 200)

        # Delete Trip
        del_trip = self.client.delete(f'/api/trips/{trip_id}')
        self.assertEqual(del_trip.status_code, 200)

    def test_05_reservations_and_bookings(self):
        # Create booking for sanctuary #3
        book_res = self.client.post('/api/bookings', json={
            'spot_id': 3,
            'booking_type': 'Dark Sky Conservation Permit',
            'travel_date': '2026-11-20',
            'party_size': 3,
            'total_amount': 45.0,
            'special_requests': 'Observing Orionids with red headlamps'
        })
        self.assertEqual(book_res.status_code, 200)
        book_data = json.loads(book_res.data)
        self.assertTrue(book_data['success'])
        booking_id = book_data['id']

        # Get user bookings
        get_books = self.client.get('/api/bookings')
        self.assertEqual(get_books.status_code, 200)
        bookings_list = json.loads(get_books.data)
        self.assertTrue(any(b['id'] == booking_id for b in bookings_list))

        # Cancel booking
        cancel_res = self.client.post(f'/api/bookings/{booking_id}/cancel')
        self.assertEqual(cancel_res.status_code, 200)

    def test_06_contact_concierge(self):
        contact_res = self.client.post('/api/contact', json={
            'name': 'David Miller',
            'email': 'david@traveler.com',
            'subject': 'Wheelchair accessible trail paths',
            'message': 'Are any of the low-decibel sacred groves accessible with all-terrain mobility devices?'
        })
        self.assertEqual(contact_res.status_code, 200)
        contact_data = json.loads(contact_res.data)
        self.assertTrue(contact_data['success'])

if __name__ == '__main__':
    unittest.main()
