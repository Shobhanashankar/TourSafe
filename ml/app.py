from flask import Flask, request, jsonify
from joblib import load, dump
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor, IsolationForest
from sklearn.model_selection import train_test_split
import os

app = Flask(__name__)

# Load models
try:
    regressor = load('models/safety_regressor.pkl')
    anomaly_detector = load('models/anomaly_detector.pkl')
except FileNotFoundError:
    # Train models if not found (for demo purposes)
    data = pd.DataFrame({
        'risk': np.random.rand(100),
        'speed': np.random.rand(100),
        'weather': np.random.rand(100),
        'crowd': np.random.rand(100),
        'score': np.random.randint(0, 100, 100)
    })
    X = data[['risk', 'speed', 'weather', 'crowd']]
    y = data['score']
    X_train, _, y_train, _ = train_test_split(X, y, test_size=0.2)
    
    regressor = RandomForestRegressor()
    regressor.fit(X_train, y_train)
    anomaly_detector = IsolationForest()
    anomaly_detector.fit(X_train)
    
    os.makedirs('models', exist_ok=True)
    dump(regressor, 'models/safety_regressor.pkl')
    dump(anomaly_detector, 'models/anomaly_detector.pkl')

@app.route('/predict-safety', methods=['POST'])
def predict_safety():
    try:
        data = request.json
        features = np.array([[data['risk'], data['speed'], data['weather'], data['crowd']]])
        score = regressor.predict(features)[0]
        color = 'green' if score >= 80 else 'yellow' if score >= 50 else 'red'
        tip = 'Adventure Ready!' if score >= 80 else 'Proceed with Caution' if score >= 50 else 'Reroute Recommended'
        return jsonify({'score': float(score), 'color': color, 'tip': tip})
    except Exception as e:
        return jsonify({'error': str(e), 'score': 85, 'color': 'green', 'tip': 'Adventure Ready!'}), 500

@app.route('/detect-anomaly', methods=['POST'])
def detect_anomaly():
    try:
        data = request.json
        features = np.array([[data['risk'], data['speed'], data['weather'], data['crowd']]])
        anomaly = anomaly_detector.predict(features)[0]
        return jsonify({'anomaly': anomaly == -1})
    except Exception as e:
        return jsonify({'error': str(e), 'anomaly': data['risk'] > 0.8}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)