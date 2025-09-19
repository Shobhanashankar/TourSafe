import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor, IsolationForest
from sklearn.model_selection import train_test_split
import joblib
import os

# Simulated data
data = pd.DataFrame({
    'risk': np.random.rand(100),
    'speed': np.random.rand(100),
    'weather': np.random.rand(100),
    'crowd': np.random.rand(100),
    'score': np.random.randint(0, 100, 100)
})
X = data[['risk', 'speed', 'weather', 'crowd']]
y = data['score']
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)

# Train models
regressor = RandomForestRegressor()
regressor.fit(X_train, y_train)
anomaly_detector = IsolationForest()
anomaly_detector.fit(X_train)

# Save models for offline use
os.makedirs('models', exist_ok=True)
joblib.dump(regressor, 'models/safety_regressor.pkl')
joblib.dump(anomaly_detector, 'models/anomaly_detector.pkl')

def predict_safety(features):
    regressor = joblib.load('models/safety_regressor.pkl')
    score = regressor.predict(features)[0]
    color = 'green' if score >= 80 else 'yellow' if score >= 50 else 'red'
    tip = 'Adventure Ready!' if score >= 80 else 'Proceed with Caution' if score >= 50 else 'Reroute Recommended'
    return {'score': score, 'color': color, 'tip': tip}

def detect_anomaly(features):
    anomaly_detector = joblib.load('models/anomaly_detector.pkl')
    anomaly = anomaly_detector.predict(features)[0]
    return {'anomaly': anomaly == -1}