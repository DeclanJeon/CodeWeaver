import re
import ast
import json
from pathlib import Path
from typing import Dict, List, Set, Tuple, Any, Optional
from collections import defaultdict
from dataclasses import dataclass, asdict
import networkx as nx

@dataclass
class DependencyNode:
    file_id: str
    file_path: str
    file_type: str
    imports: List[str]
    exports: List[str]
    dependencies: List[str]
    dependents: List[str]
    is_entry_point: bool = False
    is_leaf: bool = False

@dataclass
class MissingDependency:
    required_by: str
    required_by_path: str
    missing_import: str
    suggested_file: Optional[str] = None
    confidence: float = 0.0
    reason: str = ""

class DependencyAnalyzer:
    
    def __init__(self, all_files: Dict[str, Any], root_dir: str):
        self.all_files = all_files
        self.root_dir = Path(root_dir)
        self.dependency_graph = nx.DiGraph()
        self.import_patterns = {
            'python': [
                r'^\s*import\s+([\w.]+)',
                r'^\s*from\s+([\w.]+)\s+import',
            ],
            'javascript': [
                r'import\s+.*?\s+from\s+[\'"]([^\'"]+)[\'"]',
                r'require\([\'"]([^\'"]+)[\'"]\)',
                r'import\([\'"]([^\'"]+)[\'"]\)',
            ],
            'typescript': [
                r'import\s+.*?\s+from\s+[\'"]([^\'"]+)[\'"]',
                r'require\([\'"]([^\'"]+)[\'"]\)',
            ]
        }
    
    def analyze_dependencies(self, selected_files: List[str]) -> Dict[str, Any]:
        nodes = {}
        
        for file_id in selected_files:
            if file_id not in self.all_files:
                continue
            
            file_info = self.all_files[file_id]
            file_path = Path(file_info['path'])
            
            try:
                imports = self._extract_imports(file_path, file_info['extension'])
                exports = self._extract_exports(file_path, file_info['extension'])
                
                node = DependencyNode(
                    file_id=file_id,
                    file_path=file_info['relative_path'],
                    file_type=file_info['extension'],
                    imports=imports,
                    exports=exports,
                    dependencies=[],
                    dependents=[]
                )
                
                nodes[file_id] = node
                self.dependency_graph.add_node(file_id, **asdict(node))
                
            except Exception as e:
                print(f"Error analyzing {file_path}: {e}")
                import traceback
                traceback.print_exc()
                continue
        
        self._resolve_dependencies(nodes, selected_files)
        
        missing_deps = self._find_missing_dependencies(nodes, selected_files)
        
        cycles = self._detect_circular_dependencies()
        
        metrics = self._calculate_metrics(nodes)
        
        graph_data = self._generate_graph_data(nodes)
        
        return {
            'nodes': {k: asdict(v) for k, v in nodes.items()},
            'missing_dependencies': [asdict(d) for d in missing_deps],
            'circular_dependencies': cycles,
            'metrics': metrics,
            'graph': graph_data,
            'completeness_score': self._calculate_completeness_score(
                len(selected_files), 
                len(missing_deps)
            )
        }
    
    def _extract_imports(self, file_path: Path, extension: str) -> List[str]:
        imports = []
        
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            
            if extension == '.py':
                imports = self._extract_python_imports(content)
            elif extension in ['.js', '.jsx', '.ts', '.tsx']:
                imports = self._extract_javascript_imports(content)
            
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
        
        return imports
    
    def _extract_python_imports(self, content: str) -> List[str]:
        imports = []
        
        try:
            tree = ast.parse(content)
            
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        imports.append(alias.name)
                elif isinstance(node, ast.ImportFrom):
                    if node.module:
                        imports.append(node.module)
        except SyntaxError as e:
            print(f"Python syntax error, falling back to regex: {e}")
            for pattern in self.import_patterns['python']:
                matches = re.findall(pattern, content, re.MULTILINE)
                imports.extend(matches)
        except Exception as e:
            print(f"Error parsing Python imports: {e}")
        
        return list(set(imports))
    
    def _extract_javascript_imports(self, content: str) -> List[str]:
        imports = []
        
        for pattern in self.import_patterns['javascript']:
            matches = re.findall(pattern, content, re.MULTILINE)
            imports.extend(matches)
        
        cleaned_imports = []
        for imp in imports:
            imp = imp.strip()
            if imp.startswith('.'):
                cleaned_imports.append(imp)
            elif not imp.startswith('@') and '/' not in imp:
                continue
            else:
                cleaned_imports.append(imp)
        
        return list(set(cleaned_imports))
    
    def _extract_exports(self, file_path: Path, extension: str) -> List[str]:
        exports = []
        
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            
            if extension == '.py':
                export_patterns = [
                    r'^\s*def\s+(\w+)',
                    r'^\s*class\s+(\w+)',
                ]
            else:
                export_patterns = [
                    r'export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)',
                    r'export\s+{\s*([^}]+)\s*}',
                ]
            
            for pattern in export_patterns:
                matches = re.findall(pattern, content, re.MULTILINE)
                for match in matches:
                    if isinstance(match, str):
                        exports.extend([m.strip() for m in match.split(',')])
                    else:
                        exports.append(match)
        
        except Exception as e:
            print(f"Error reading exports from {file_path}: {e}")
        
        return list(set(exports))
    
    def _resolve_dependencies(
        self, 
        nodes: Dict[str, DependencyNode], 
        selected_files: List[str]
    ):
        file_path_to_id = {
            self.all_files[fid]['relative_path']: fid 
            for fid in selected_files 
            if fid in self.all_files
        }
        
        for file_id, node in nodes.items():
            current_file_path = Path(node.file_path)
            current_dir = current_file_path.parent
            
            for imp in node.imports:
                resolved_path = self._resolve_import_path(
                    imp, 
                    current_dir, 
                    node.file_type
                )
                
                if resolved_path and resolved_path in file_path_to_id:
                    dep_file_id = file_path_to_id[resolved_path]
                    
                    if dep_file_id != file_id:
                        node.dependencies.append(dep_file_id)
                        
                        if dep_file_id in nodes:
                            nodes[dep_file_id].dependents.append(file_id)
                        
                        self.dependency_graph.add_edge(file_id, dep_file_id)
        
        for node in nodes.values():
            node.is_entry_point = len(node.dependents) == 0
            node.is_leaf = len(node.dependencies) == 0
    
    def _resolve_import_path(
        self, 
        import_path: str, 
        current_dir: Path, 
        file_type: str
    ) -> Optional[str]:
        if not import_path.startswith('.'):
            return None
        
        extensions = ['.py'] if file_type == '.py' else ['.js', '.jsx', '.ts', '.tsx']
        
        try:
            resolved = (self.root_dir / current_dir / import_path).resolve()
        except Exception as e:
            print(f"Error resolving path {import_path}: {e}")
            return None
        
        for ext in extensions:
            candidate = resolved.with_suffix(ext)
            try:
                relative_to_root = candidate.relative_to(self.root_dir)
                
                if any(
                    f['relative_path'] == str(relative_to_root) 
                    for f in self.all_files.values()
                ):
                    return str(relative_to_root)
            except ValueError:
                continue
        
        for ext in extensions:
            candidate = resolved / f"index{ext}"
            try:
                relative_to_root = candidate.relative_to(self.root_dir)
                if any(
                    f['relative_path'] == str(relative_to_root) 
                    for f in self.all_files.values()
                ):
                    return str(relative_to_root)
            except ValueError:
                continue
        
        return None
    
    def _find_missing_dependencies(
        self, 
        nodes: Dict[str, DependencyNode], 
        selected_files: List[str]
    ) -> List[MissingDependency]:
        missing = []
        selected_paths = {
            self.all_files[fid]['relative_path'] 
            for fid in selected_files 
            if fid in self.all_files
        }
        
        for file_id, node in nodes.items():
            current_dir = Path(node.file_path).parent
            
            for imp in node.imports:
                resolved_path = self._resolve_import_path(
                    imp, 
                    current_dir, 
                    node.file_type
                )
                
                if resolved_path and resolved_path not in selected_paths:
                    suggestion = self._suggest_missing_file(resolved_path)
                    
                    missing.append(MissingDependency(
                        required_by=file_id,
                        required_by_path=node.file_path,
                        missing_import=imp,
                        suggested_file=suggestion['file_id'] if suggestion else None,
                        confidence=suggestion['confidence'] if suggestion else 0.0,
                        reason=suggestion['reason'] if suggestion else "File not found"
                    ))
        
        return missing
    
    def _suggest_missing_file(self, missing_path: str) -> Optional[Dict]:
        for file_id, file_info in self.all_files.items():
            if file_info['relative_path'] == missing_path:
                return {
                    'file_id': file_id,
                    'confidence': 1.0,
                    'reason': 'Exact path match found'
                }
        
        missing_name = Path(missing_path).name
        candidates = []
        
        for file_id, file_info in self.all_files.items():
            file_name = Path(file_info['relative_path']).name
            
            if file_name == missing_name:
                candidates.append({
                    'file_id': file_id,
                    'confidence': 0.8,
                    'reason': f'Filename matches: {file_info["relative_path"]}'
                })
            elif missing_name in file_name or file_name in missing_name:
                candidates.append({
                    'file_id': file_id,
                    'confidence': 0.5,
                    'reason': f'Similar filename: {file_info["relative_path"]}'
                })
        
        return candidates[0] if candidates else None
    
    def _detect_circular_dependencies(self) -> List[List[str]]:
        try:
            cycles = list(nx.simple_cycles(self.dependency_graph))
            return cycles
        except Exception as e:
            print(f"Error detecting cycles: {e}")
            return []
    
    def _calculate_metrics(self, nodes: Dict[str, DependencyNode]) -> Dict:
        total_files = len(nodes)
        
        if total_files == 0:
            return {
                'total_files': 0,
                'entry_points': 0,
                'leaf_nodes': 0,
                'average_dependencies': 0,
                'max_dependencies': 0,
                'most_dependent_file': None,
                'coupling_score': 0
            }
        
        entry_points = sum(1 for n in nodes.values() if n.is_entry_point)
        leaf_nodes = sum(1 for n in nodes.values() if n.is_leaf)
        
        dep_counts = [len(n.dependencies) for n in nodes.values()]
        avg_deps = sum(dep_counts) / total_files if total_files > 0 else 0
        max_deps = max(dep_counts) if dep_counts else 0
        
        most_dependent = max(
            nodes.items(), 
            key=lambda x: len(x[1].dependents),
            default=(None, None)
        )
        
        total_possible_deps = total_files * (total_files - 1)
        actual_deps = sum(dep_counts)
        coupling_score = (actual_deps / total_possible_deps * 100) if total_possible_deps > 0 else 0
        
        return {
            'total_files': total_files,
            'entry_points': entry_points,
            'leaf_nodes': leaf_nodes,
            'average_dependencies': round(avg_deps, 2),
            'max_dependencies': max_deps,
            'most_dependent_file': {
                'file_id': most_dependent[0],
                'file_path': most_dependent[1].file_path if most_dependent[1] else None,
                'dependent_count': len(most_dependent[1].dependents) if most_dependent[1] else 0
            } if most_dependent[0] else None,
            'coupling_score': round(coupling_score, 2)
        }
    
    def _generate_graph_data(self, nodes: Dict[str, DependencyNode]) -> Dict:
        graph_nodes = []
        graph_edges = []
        
        for file_id, node in nodes.items():
            graph_nodes.append({
                'id': file_id,
                'label': Path(node.file_path).name,
                'path': node.file_path,
                'type': node.file_type,
                'is_entry_point': node.is_entry_point,
                'is_leaf': node.is_leaf,
                'dependency_count': len(node.dependencies),
                'dependent_count': len(node.dependents)
            })
            
            for dep_id in node.dependencies:
                graph_edges.append({
                    'source': file_id,
                    'target': dep_id
                })
        
        return {
            'nodes': graph_nodes,
            'edges': graph_edges
        }
    
    def _calculate_completeness_score(
        self, 
        selected_count: int, 
        missing_count: int
    ) -> float:
        if selected_count == 0:
            return 0.0
        
        total = selected_count + missing_count
        score = (selected_count / total) * 100
        
        return round(score, 2)