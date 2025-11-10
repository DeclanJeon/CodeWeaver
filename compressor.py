import re
import json
import gzip
import base64
import hashlib
from pathlib import Path
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict
from collections import defaultdict

@dataclass
class CodeBlock:
    type: str
    name: str
    purpose: str
    key_logic: List[str]
    dependencies: List[str]

class SemanticCompressor:
    
    def __init__(self):
        self.js_patterns = {
            'function': r'(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*{',
            'arrow_func': r'const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>',
            'event_listener': r'(\w+)\.addEventListener\([\'"](\w+)[\'"],',
            'api_call': r'fetch\([\'"]([^\'"]+)[\'"]',
            'dom_query': r'document\.(?:getElementById|querySelector(?:All)?)\([\'"]([^\'"]+)[\'"]'
        }
        
        self.css_patterns = {
            'class': r'\.([a-zA-Z0-9_-]+)\s*{',
            'id': r'#([a-zA-Z0-9_-]+)\s*{',
            'color': r'(#[0-9a-fA-F]{3,6}|rgba?\([^)]+\))',
            'size': r'(\d+(?:\.\d+)?(?:px|rem|em|%))'
        }
        
        self.py_patterns = {
            'class': r'class\s+(\w+)(?:\([^)]*\))?:',
            'function': r'def\s+(\w+)\s*\([^)]*\):',
            'decorator': r'@(\w+)',
            'import': r'(?:from\s+[\w.]+\s+)?import\s+([\w,\s]+)',
            'route': r'@app\.route\([\'"]([^\'"]+)[\'"]'
        }
    
    def compress_javascript(self, content: str, filename: str) -> Dict:
        functions = {}
        for match in re.finditer(self.js_patterns['function'], content):
            func_name = match.group(1)
            func_start = match.start()
            func_body = self._extract_block(content, func_start)
            
            functions[func_name] = {
                'type': 'async' if 'async' in match.group(0) else 'sync',
                'purpose': self._extract_purpose(func_body),
                'api_calls': re.findall(self.js_patterns['api_call'], func_body),
                'dom_interactions': re.findall(self.js_patterns['dom_query'], func_body),
                'flow': self._extract_flow(func_body),
                'lines': len(func_body.split('\n'))
            }
        
        for match in re.finditer(self.js_patterns['arrow_func'], content):
            func_name = match.group(1)
            functions[func_name] = {
                'type': 'arrow',
                'purpose': 'Arrow function',
                'lines': 1
            }
        
        event_handlers = []
        for match in re.finditer(self.js_patterns['event_listener'], content):
            event_handlers.append(f"{match.group(1)}→{match.group(2)}")
        
        return {
            'file': filename,
            'type': 'javascript',
            'functions': functions,
            'event_handlers': event_handlers,
            'globals': self._extract_globals(content),
            'complexity_score': len(functions),
            'total_lines': len(content.split('\n'))
        }
    
    def compress_css(self, content: str, filename: str) -> Dict:
        colors = list(set(re.findall(self.css_patterns['color'], content)))[:15]
        
        classes = {}
        for match in re.finditer(r'\.([a-zA-Z0-9_-]+)\s*{([^}]+)}', content):
            class_name = match.group(1)
            properties = match.group(2)
            
            key_props = self._extract_key_properties(properties)
            if key_props:
                classes[class_name] = key_props
        
        media_queries = re.findall(r'@media\s*([^{]+)', content)
        
        return {
            'file': filename,
            'type': 'css',
            'design_tokens': {
                'colors': colors,
                'spacing': self._extract_spacing(content),
                'typography': self._extract_typography(content)
            },
            'components': classes,
            'media_queries': media_queries[:5],
            'total_lines': len(content.split('\n'))
        }
    
    def compress_python(self, content: str, filename: str) -> Dict:
        classes = {}
        for match in re.finditer(self.py_patterns['class'], content):
            class_name = match.group(1)
            class_start = match.start()
            class_body = self._extract_block(content, class_start, indent_based=True)
            
            methods = {}
            for method_match in re.finditer(r'def\s+(\w+)\s*\([^)]*\):', class_body):
                method_name = method_match.group(1)
                method_body = self._extract_block(class_body, method_match.start(), indent_based=True)
                
                methods[method_name] = {
                    'purpose': self._extract_docstring(method_body),
                    'logic': self._extract_logic_summary(method_body),
                    'lines': len(method_body.split('\n'))
                }
            
            classes[class_name] = {
                'methods': methods,
                'attributes': self._extract_attributes(class_body)
            }
        
        routes = {}
        for match in re.finditer(self.py_patterns['route'], content):
            route_path = match.group(1)
            route_start = match.start()
            route_func = self._extract_block(content, route_start, indent_based=True)
            
            routes[route_path] = {
                'method': self._extract_http_method(route_func),
                'flow': self._extract_flow(route_func),
                'returns': self._extract_return_type(route_func)
            }
        
        return {
            'file': filename,
            'type': 'python',
            'classes': classes,
            'routes': routes,
            'imports': self._extract_imports(content),
            'complexity_score': len(classes) + len(routes),
            'total_lines': len(content.split('\n'))
        }
    
    def compress_html(self, content: str, filename: str) -> Dict:
        tags = re.findall(r'<(\w+)', content)
        tag_counts = defaultdict(int)
        for tag in tags:
            tag_counts[tag] += 1
        
        scripts = re.findall(r'<script[^>]*src=[\'"]([^\'"]+)[\'"]', content)
        styles = re.findall(r'<link[^>]*href=[\'"]([^\'"]+)[\'"]', content)
        
        return {
            'file': filename,
            'type': 'html',
            'structure': dict(tag_counts),
            'external_scripts': scripts,
            'external_styles': styles,
            'total_lines': len(content.split('\n'))
        }
    
    def compress_generic(self, content: str, filename: str, language: str) -> Dict:
        return {
            'file': filename,
            'type': language,
            'total_lines': len(content.split('\n')),
            'size': len(content),
            'summary': 'Generic text file'
        }
    
    def _extract_block(self, content: str, start: int, indent_based: bool = False) -> str:
        if indent_based:
            lines = content[start:].split('\n')
            if not lines:
                return ''
            
            base_indent = len(lines[0]) - len(lines[0].lstrip())
            block_lines = [lines[0]]
            
            for line in lines[1:]:
                if line.strip() == '':
                    block_lines.append(line)
                    continue
                
                current_indent = len(line) - len(line.lstrip())
                if current_indent <= base_indent and line.strip():
                    break
                block_lines.append(line)
            
            return '\n'.join(block_lines)
        else:
            brace_count = 0
            in_block = False
            block_end = start
            
            for i, char in enumerate(content[start:], start):
                if char == '{':
                    brace_count += 1
                    in_block = True
                elif char == '}':
                    brace_count -= 1
                    if brace_count == 0 and in_block:
                        block_end = i + 1
                        break
            
            return content[start:block_end]
    
    def _extract_purpose(self, code: str) -> str:
        comment_match = re.search(r'/\*\*?\s*([^\n*]+)', code)
        if comment_match:
            return comment_match.group(1).strip()[:100]
        
        single_comment = re.search(r'//\s*(.+)', code)
        if single_comment:
            return single_comment.group(1).strip()[:100]
        
        return "Processing logic"
    
    def _extract_flow(self, code: str) -> str:
        steps = []
        
        if re.search(r'\bif\b', code):
            steps.append('conditional')
        if re.search(r'\b(fetch|await)\b', code):
            steps.append('async_call')
        if re.search(r'\b(forEach|map|filter|reduce)\b', code):
            steps.append('iteration')
        if re.search(r'\breturn\b', code):
            steps.append('return')
        if re.search(r'\btry\b', code):
            steps.append('error_handling')
        
        return ' → '.join(steps) if steps else 'simple_execution'
    
    def _extract_globals(self, content: str) -> List[str]:
        globals_section = content.split('function')[0] if 'function' in content else content[:1000]
        
        let_vars = re.findall(r'\blet\s+(\w+)', globals_section)
        const_vars = re.findall(r'\bconst\s+(\w+)', globals_section)
        
        return list(set(let_vars + const_vars))[:15]
    
    def _extract_key_properties(self, properties: str) -> Dict:
        key_props = {}
        
        display_match = re.search(r'display:\s*([^;]+)', properties)
        if display_match:
            key_props['display'] = display_match.group(1).strip()
        
        bg_match = re.search(r'background[^:]*:\s*([^;]+)', properties)
        if bg_match:
            key_props['background'] = bg_match.group(1).strip()[:50]
        
        if 'padding' in properties or 'margin' in properties:
            key_props['spacing'] = 'custom'
        
        return key_props if len(key_props) > 0 else None
    
    def _extract_spacing(self, content: str) -> str:
        rem_values = re.findall(r'(\d+(?:\.\d+)?rem)', content)
        if rem_values:
            unique_values = sorted(set(rem_values))
            return f"rem-based ({unique_values[0]} to {unique_values[-1]})"
        return "pixel-based"
    
    def _extract_typography(self, content: str) -> str:
        font_match = re.search(r'font-family:\s*([^;]+)', content)
        if font_match:
            return font_match.group(1).strip()[:60]
        return "default-font"
    
    def _extract_docstring(self, code: str) -> str:
        docstring_match = re.search(r'"""([^"]+)"""', code)
        if docstring_match:
            return docstring_match.group(1).strip()[:150]
        
        comment_match = re.search(r'#\s*(.+)', code)
        if comment_match:
            return comment_match.group(1).strip()[:150]
        
        return ""
    
    def _extract_logic_summary(self, code: str) -> str:
        keywords = {
            'for': 'loop',
            'while': 'loop',
            'if': 'conditional',
            'try': 'error_handling',
            'return': 'return',
            'yield': 'generator',
            'async': 'async',
            'await': 'async'
        }
        
        found = []
        for kw, desc in keywords.items():
            if re.search(rf'\b{kw}\b', code):
                if desc not in found:
                    found.append(desc)
        
        return ' + '.join(found[:4]) if found else "simple_processing"
    
    def _extract_attributes(self, code: str) -> List[str]:
        self_attrs = re.findall(r'self\.(\w+)\s*=', code)
        return list(set(self_attrs))[:10]
    
    def _extract_http_method(self, code: str) -> str:
        if "methods=['POST']" in code or "method: 'POST'" in code:
            return 'POST'
        elif "methods=['GET']" in code:
            return 'GET'
        elif "methods=['PUT']" in code:
            return 'PUT'
        elif "methods=['DELETE']" in code:
            return 'DELETE'
        return 'GET'
    
    def _extract_return_type(self, code: str) -> str:
        if 'jsonify' in code:
            return 'JSON'
        elif 'send_file' in code:
            return 'File'
        elif 'render_template' in code:
            return 'HTML'
        elif 'redirect' in code:
            return 'Redirect'
        return 'Unknown'
    
    def _extract_imports(self, content: str) -> List[str]:
        imports = []
        for match in re.finditer(self.py_patterns['import'], content):
            imports.extend([imp.strip() for imp in match.group(1).split(',')])
        return imports[:15]
    
    def compress_markdown(self, md_content: str) -> Dict:
        files_match = re.split(r'\n## (.+?)\n', md_content)
        
        if len(files_match) < 2:
            return {
                'error': 'Invalid markdown format',
                'metadata': {
                    'original_size': len(md_content),
                    'compressed_size': 0,
                    'compression_ratio': 0
                }
            }
        
        header = files_match[0]
        files = files_match[1:]
        
        compressed_files = []
        
        for i in range(0, len(files), 2):
            if i + 1 >= len(files):
                break
            
            filename = files[i].strip()
            content = files[i + 1]
            
            code_match = re.search(r'```(\w+)\n(.*?)\n```', content, re.DOTALL)
            if not code_match:
                continue
            
            language = code_match.group(1).lower()
            code = code_match.group(2)
            
            if language in ['javascript', 'js', 'jsx']:
                compressed = self.compress_javascript(code, filename)
            elif language == 'css':
                compressed = self.compress_css(code, filename)
            elif language == 'python':
                compressed = self.compress_python(code, filename)
            elif language == 'html':
                compressed = self.compress_html(code, filename)
            else:
                compressed = self.compress_generic(code, filename, language)
            
            compressed_files.append(compressed)
        
        compressed_json = json.dumps(compressed_files, ensure_ascii=False, indent=2)
        
        return {
            'metadata': {
                'original_size': len(md_content),
                'compressed_size': len(compressed_json),
                'compression_ratio': round(len(compressed_json) / len(md_content) * 100, 2),
                'files_count': len(compressed_files),
                'compression_type': 'semantic_lossy'
            },
            'files': compressed_files
        }


class LosslessCompressor:
    
    def compress_markdown(self, md_content: str) -> Dict:
        compressed_bytes = gzip.compress(md_content.encode('utf-8'), compresslevel=9)
        
        base64_encoded = base64.b64encode(compressed_bytes).decode('ascii')
        
        file_hash = hashlib.sha256(md_content.encode()).hexdigest()[:16]
        
        return {
            'metadata': {
                'original_size': len(md_content),
                'compressed_size': len(base64_encoded),
                'compression_ratio': round(len(base64_encoded) / len(md_content) * 100, 2),
                'compression_type': 'gzip_lossless',
                'hash': file_hash
            },
            'data': base64_encoded,
            'encoding': 'gzip+base64'
        }
    
    def decompress_markdown(self, compressed_data: Dict) -> str:
        base64_decoded = base64.b64decode(compressed_data['data'])
        
        original_bytes = gzip.decompress(base64_decoded)
        
        return original_bytes.decode('utf-8')


class HybridCompressor:
    
    def __init__(self):
        self.semantic_compressor = SemanticCompressor()
        self.lossless_compressor = LosslessCompressor()
    
    def compress_with_reference(self, md_content: str, storage_dir: Path) -> Dict:
        structure = self.semantic_compressor.compress_markdown(md_content)
        
        file_hash = hashlib.sha256(md_content.encode()).hexdigest()[:16]
        storage_path = storage_dir / f"original_{file_hash}.md"
        
        # Ensure storage directory exists
        storage_dir.mkdir(exist_ok=True, parents=True)
        
        with open(storage_path, 'w', encoding='utf-8') as f:
            f.write(md_content)
        
        # Calculate compression ratio
        structure_size = len(json.dumps(structure))
        original_size = len(md_content)
        compression_ratio = round(structure_size / original_size * 100, 2) if original_size > 0 else 0
        
        return {
            'structure': structure,
            'original_reference': {
                'hash': file_hash,
                'path': str(storage_path),
                'size': len(md_content),
                'filename': storage_path.name
            },
            'metadata': {
                'compression_type': 'hybrid',
                'structure_size': structure_size,
                'original_size': original_size,
                'compressed_size': structure_size,
                'compression_ratio': compression_ratio
            },
            # Store the original content directly in the compressed data
            'original_content': md_content
        }
    
    def get_original_content(self, file_reference: Dict, compressed_data: Dict = None) -> Optional[str]:
        # First try to get from file system
        storage_path = Path(file_reference['path'])
        
        if storage_path.exists():
            with open(storage_path, 'r', encoding='utf-8') as f:
                return f.read()
        
        # If file doesn't exist, try to get from compressed data
        if compressed_data and 'original_content' in compressed_data:
            return compressed_data['original_content']
        
        return None
    
    def get_file_content(self, file_reference: Dict, file_path: str, compressed_data: Dict = None) -> Optional[str]:
        full_content = self.get_original_content(file_reference, compressed_data)
        
        if not full_content:
            return None
        
        pattern = rf'\n## {re.escape(file_path)}\n.*?```\w+\n(.*?)\n```'
        match = re.search(pattern, full_content, re.DOTALL)
        
        if match:
            return match.group(1)
        
        return None