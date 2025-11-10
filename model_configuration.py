#!/usr/bin/env python3
"""
Enhanced Model Configuration System
Supports dynamic model selection via environment variables with performance monitoring
"""

import os
import time
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta

class ModelPerformanceMonitor:
    """Monitor model performance and suggest optimal models"""

    def __init__(self):
        self.performance_data = {}
        self.failure_counts = {}
        self.logger = logging.getLogger(__name__)

    def record_success(self, model_name: str, response_time: float, complexity_score: int = 0):
        """Record successful model usage"""
        if model_name not in self.performance_data:
            self.performance_data[model_name] = {
                'success_count': 0,
                'total_response_time': 0,
                'avg_response_time': 0,
                'last_success': None,
                'complexity_scores': []
            }

        data = self.performance_data[model_name]
        data['success_count'] += 1
        data['total_response_time'] += response_time
        data['avg_response_time'] = data['total_response_time'] / data['success_count']
        data['last_success'] = datetime.now()
        data['complexity_scores'].append(complexity_score)

        # Keep only recent complexity scores (last 20)
        if len(data['complexity_scores']) > 20:
            data['complexity_scores'] = data['complexity_scores'][-20:]

    def record_failure(self, model_name: str):
        """Record model failure"""
        if model_name not in self.failure_counts:
            self.failure_counts[model_name] = 0
        self.failure_counts[model_name] += 1

    def should_switch_model(self, model_name: str, task_type: str) -> bool:
        """Determine if model should be switched due to performance issues"""
        if not os.getenv('GEMINI_AUTO_SWITCH', 'true').lower() == 'true':
            return False

        # Check failure rate
        failure_count = self.failure_counts.get(model_name, 0)
        success_count = self.performance_data.get(model_name, {}).get('success_count', 0)

        total_attempts = failure_count + success_count
        if total_attempts > 5 and failure_count / total_attempts > 0.3:
            self.logger.warning(f"High failure rate for {model_name}: {failure_count}/{total_attempts}")
            return True

        # Check response time performance
        perf_data = self.performance_data.get(model_name, {})
        if perf_data.get('success_count', 0) >= 3:
            avg_time = perf_data.get('avg_response_time', 0)
            if avg_time > 45:  # 45 seconds threshold
                self.logger.warning(f"Slow response time for {model_name}: {avg_time:.2f}s")
                return True

        return False

    def get_best_model(self, task_type: str, available_models: List[str]) -> Optional[str]:
        """Get the best performing model for a task type"""
        if not available_models:
            return None

        # Filter models that have sufficient data
        candidates = []
        for model in available_models:
            perf_data = self.performance_data.get(model, {})
            if perf_data.get('success_count', 0) >= 2:
                avg_time = perf_data.get('avg_response_time', float('inf'))
                failure_rate = self.failure_counts.get(model, 0) / (perf_data.get('success_count', 1) + self.failure_counts.get(model, 0))
                candidates.append((model, avg_time, failure_rate))

        if candidates:
            # Sort by average response time and failure rate
            candidates.sort(key=lambda x: (x[1], x[2]))
            return candidates[0][0]

        # Fallback to first available model
        return available_models[0] if available_models else None

class ModelConfiguration:
    """Enhanced model configuration with dynamic selection"""

    def __init__(self):
        self.models = self._load_model_config()
        self.performance_monitor = ModelPerformanceMonitor()
        self.logger = logging.getLogger(__name__)

        # Validate configuration
        self._validate_configuration()

    def _load_model_config(self) -> Dict[str, Any]:
        """Load comprehensive model configuration from environment variables"""
        config = {
            # Primary settings
            'api_key': os.getenv('GEMINI_API_KEY', ''),
            'default_model': os.getenv('GEMINI_DEFAULT_MODEL', 'gemini-2.5-flash'),

            # Task-specific models
            'documentation': {
                'primary': os.getenv('GEMINI_DOCS_MODEL', 'gemini-2.5-flash'),
                'fallback': os.getenv('GEMINI_DOCS_FALLBACK', 'gemini-2.5-flash'),
                'architecture': os.getenv('GEMINI_ARCH_MODEL', 'gemini-2.5-flash'),
                'readme': os.getenv('GEMINI_README_MODEL', 'gemini-2.5-flash'),
                'api_docs': os.getenv('GEMINI_API_MODEL', 'gemini-2.5-flash'),
                'summary': os.getenv('GEMINI_SUMMARY_MODEL', 'gemini-2.5-flash')
            },

            # Analysis models
            'analysis': {
                'dependency': os.getenv('GEMINI_DEPS_MODEL', 'gemini-2.5-flash'),
                'file_selection': os.getenv('GEMINI_SELECT_MODEL', 'gemini-2.5-flash'),
                'code_analysis': os.getenv('GEMINI_ANALYSIS_MODEL', 'gemini-2.5-flash')
            },

            # Performance settings
            'performance': {
                'timeout': int(os.getenv('GEMINI_TIMEOUT', '60')),
                'max_retries': int(os.getenv('GEMINI_MAX_RETRIES', '3')),
                'auto_switch': os.getenv('GEMINI_AUTO_SWITCH', 'true').lower() == 'true',
                'monitoring': os.getenv('GEMINI_PERFORMANCE_MONITORING', 'true').lower() == 'true'
            },

            # Diagram settings
            'diagram': {
                'max_nodes': int(os.getenv('DIAGRAM_MAX_NODES', '100')),
                'max_edges': int(os.getenv('DIAGRAM_MAX_EDGES', '200')),
                'enable_validation': os.getenv('DIAGRAM_ENABLE_VALIDATION', 'true').lower() == 'true',
                'fallback_strategies': int(os.getenv('DIAGRAM_FALLBACK_STRATEGIES', '3'))
            },

            # Generation settings
            'generation': {
                'temperature': float(os.getenv('GEMINI_TEMPERATURE', '0.7')),
                'top_p': float(os.getenv('GEMINI_TOP_P', '0.95')),
                'top_k': int(os.getenv('GEMINI_TOP_K', '40')),
                'max_output_tokens': int(os.getenv('GEMINI_MAX_TOKENS', '8192')),
                'pro_max_output_tokens': int(os.getenv('GEMINI_PRO_MAX_TOKENS', '32768'))
            }
        }

        return config

    def _validate_configuration(self):
        """Validate the loaded configuration"""
        # Check API key
        if not self.models['api_key']:
            self.logger.error("GEMINI_API_KEY environment variable is required")
            raise ValueError("GEMINI_API_KEY is required")

        # Validate model names
        valid_models = [
            'gemini-2.5-flash', 'gemini-2.5-pro',
            'gemini-2.5-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'
        ]

        for category, models in self.models['documentation'].items():
            if models and models not in valid_models:
                self.logger.warning(f"Potentially invalid model in {category}: {models}")

        for category, models in self.models['analysis'].items():
            if models and models not in valid_models:
                self.logger.warning(f"Potentially invalid model in {category}: {models}")

    def get_model_for_task(self, task_type: str, subtask: str = None, complexity_score: int = 0) -> str:
        """
        Get optimal model for a specific task with dynamic selection

        Args:
            task_type: Main task type (documentation, analysis)
            subtask: Specific subtask (architecture, readme, dependency, etc.)
            complexity_score: Project complexity score (0-100)
        """
        # Determine available models
        if task_type == 'documentation':
            if subtask == 'architecture':
                available_models = [
                    self.models['documentation']['architecture'],
                    self.models['documentation']['primary'],
                    self.models['documentation']['fallback']
                ]
            elif subtask == 'readme':
                available_models = [
                    self.models['documentation']['readme'],
                    self.models['documentation']['primary'],
                    self.models['documentation']['fallback']
                ]
            elif subtask == 'api_docs':
                available_models = [
                    self.models['documentation']['api_docs'],
                    self.models['documentation']['primary'],
                    self.models['documentation']['fallback']
                ]
            else:
                available_models = [
                    self.models['documentation']['primary'],
                    self.models['documentation']['fallback']
                ]

        elif task_type == 'analysis':
            if subtask == 'dependency':
                available_models = [
                    self.models['analysis']['dependency'],
                    self.models['analysis']['code_analysis']
                ]
            elif subtask == 'file_selection':
                available_models = [
                    self.models['analysis']['file_selection']
                ]
            else:
                available_models = [
                    self.models['analysis']['code_analysis']
                ]

        else:
            # Fallback to default
            available_models = [self.models['default_model']]

        # Filter out None/empty values
        available_models = [m for m in available_models if m]

        if not available_models:
            available_models = [self.models['default_model']]

        # Dynamic model selection based on performance
        if self.models['performance']['auto_switch']:
            best_model = self.performance_monitor.get_best_model(task_type, available_models)
            if best_model:
                return best_model

        # For complex projects, prefer more capable models
        if complexity_score > 70 and 'pro' in available_models[0]:
            pro_models = [m for m in available_models if 'pro' in m]
            if pro_models:
                return pro_models[0]

        return available_models[0]

    def get_generation_config(self, use_pro: bool = False) -> Dict[str, Any]:
        """Get generation configuration"""
        base_config = {
            'temperature': self.models['generation']['temperature'],
            'top_p': self.models['generation']['top_p'],
            'top_k': self.models['generation']['top_k']
        }

        if use_pro:
            base_config['max_output_tokens'] = self.models['generation']['pro_max_output_tokens']
        else:
            base_config['max_output_tokens'] = self.models['generation']['max_output_tokens']

        return base_config

    def get_performance_settings(self) -> Dict[str, Any]:
        """Get performance-related settings"""
        return {
            'timeout': self.models['performance']['timeout'],
            'max_retries': self.models['performance']['max_retries'],
            'auto_switch': self.models['performance']['auto_switch'],
            'monitoring': self.models['performance']['monitoring']
        }

    def get_diagram_settings(self) -> Dict[str, Any]:
        """Get diagram generation settings"""
        return {
            'max_nodes': self.models['diagram']['max_nodes'],
            'max_edges': self.models['diagram']['max_edges'],
            'enable_validation': self.models['diagram']['enable_validation'],
            'fallback_strategies': self.models['diagram']['fallback_strategies']
        }

    def should_monitor_performance(self) -> bool:
        """Check if performance monitoring is enabled"""
        return self.models['performance']['monitoring']

    def record_model_performance(self, model_name: str, success: bool, response_time: float = None, complexity_score: int = 0):
        """Record model performance for monitoring"""
        if self.models['performance']['monitoring']:
            if success and response_time is not None:
                self.performance_monitor.record_success(model_name, response_time, complexity_score)
            elif not success:
                self.performance_monitor.record_failure(model_name)

# Global configuration instance
_model_config = None

def get_model_config() -> ModelConfiguration:
    """Get global model configuration instance"""
    global _model_config
    if _model_config is None:
        _model_config = ModelConfiguration()
    return _model_config

def reload_model_config():
    """Reload model configuration (useful for testing)"""
    global _model_config
    _model_config = ModelConfiguration()
    return _model_config