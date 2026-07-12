import unittest
from app import app


class HealthTest(unittest.TestCase):
    def test_health(self):
        response = app.test_client().get('/health')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'status': 'ok'})
