import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect, useRef } from 'react';
import { useSwipeable } from 'react-swipeable';
import { auth, db, storage } from './firebase'; // firebase.tsからインポート
import Logo from './components/Logo';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { collection, addDoc, query, onSnapshot, deleteDoc, doc, updateDoc, Timestamp, } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Camera, Plus, Trash2, Edit2, Save, X, Search, ChevronDown, ChevronUp, AlertTriangle, Package, ArrowLeft, Image as ImageIcon, Utensils, Droplet, Home, Filter, RefreshCw, ShoppingCart, Minus, Battery, BatteryMedium, BatteryLow, BatteryWarning } from 'lucide-react';
const UNIT_DEFINITIONS = {
    '個': { label: '個', type: 'count' },
    '本': { label: '本', type: 'count' },
    '枚': { label: '枚', type: 'count' },
    'パック': { label: 'パック', type: 'count' },
    '袋': { label: '袋', type: 'count' },
    '束': { label: '束', type: 'count' },
    '玉': { label: '玉', type: 'count' },
    '箱': { label: '箱', type: 'count' },
    '皿': { label: '皿', type: 'count' },
    '杯': { label: '杯', type: 'count' },
    '残量': {
        label: '残量 (液体等)',
        type: 'level',
        options: [
            { value: 100, label: '満タン' },
            { value: 66, label: '2/3' },
            { value: 50, label: '半分' },
            { value: 33, label: '1/3' },
            { value: 10, label: '少' },
            { value: 0, label: '空' }
        ]
    }
};
// --- Utilities ---
// 画像をリサイズ・圧縮してBlobを返す
const compressImageToBlob = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 1000; // 長辺1000pxに制限
                const scaleSize = MAX_WIDTH / Math.max(img.width, MAX_WIDTH);
                canvas.width = img.width * scaleSize;
                canvas.height = img.height * scaleSize;
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
                canvas.toBlob((blob) => {
                    if (blob)
                        resolve(blob);
                    else
                        reject(new Error('Canvas to Blob failed'));
                }, 'image/jpeg', 0.7); // 70% quality JPEG
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (err) => reject(err);
    });
};
// Guess category & unit heuristics used when user types product name
const guessCategoryAndUnit = (name, location) => {
    const n = (name || '').toString();
    let category = '';
    let unit = '';
    const loc = location || 'kitchen';
    if (loc === 'kitchen') {
        if (n.includes('牛') || n.includes('豚') || n.includes('鶏') || n.includes('肉') || n.includes('ハム') || n.includes('ソーセージ') || n.includes('魚')) {
            category = '肉・魚';
            unit = 'パック';
        }
        else if (n.includes('キャベツ') || n.includes('レタス') || n.includes('トマト') || n.includes('野菜')) {
            category = '野菜';
            unit = '個';
            if (n.includes('キャベツ') || n.includes('レタス'))
                unit = '玉';
        }
        else if (n.includes('牛乳') || n.includes('ジュース') || n.includes('茶') || n.includes('水') || n.includes('酒')) {
            category = '飲料';
            unit = '本';
        }
        else if (n.includes('醤油') || n.includes('ソース') || n.includes('マヨネーズ') || n.includes('ケチャップ') || n.includes('油') || n.includes('ドレッシング')) {
            category = '調味料';
            unit = '本';
        }
        else if (n.includes('パスタ') || n.includes('麺') || n.includes('そば') || n.includes('うどん')) {
            category = '乾物';
            unit = '袋';
            if (n.includes('そば') || (n.includes('うどん') && !n.includes('カップ')))
                unit = '束';
        }
        else if (n.includes('納豆') || n.includes('豆腐') || n.includes('ヨーグルト') || n.includes('チーズ') || n.includes('卵')) {
            category = '冷蔵品';
            unit = 'パック';
            if (n.includes('チーズ'))
                unit = '個';
        }
        else if (n.includes('アイス') || n.includes('冷凍')) {
            category = '冷凍品';
            unit = '個';
        }
        else if (n.includes('チョコ') || n.includes('クッキー') || n.includes('菓子')) {
            category = 'お菓子';
            unit = '袋';
        }
        else if (n.includes('米')) {
            category = '乾物';
            unit = '袋';
        }
    }
    else {
        if (n.includes('洗剤') || n.includes('漂白剤') || n.includes('柔軟剤')) {
            category = '洗剤';
            unit = '本';
            if (n.includes('詰替'))
                unit = '袋';
        }
        else if (n.includes('シャンプー') || n.includes('リンス') || n.includes('コンディショナー')) {
            category = 'ヘアケア';
            unit = '本';
            if (n.includes('詰替'))
                unit = '袋';
        }
        else if (n.includes('ソープ') || n.includes('石鹸')) {
            category = '日用品';
            unit = '個';
            if (n.includes('ソープ') && !n.includes('石鹸'))
                unit = '本';
            if (n.includes('詰替'))
                unit = '袋';
        }
        else if (n.includes('歯磨き') || n.includes('歯ブラシ')) {
            category = 'オーラルケア';
            unit = '本';
        }
        else if (n.includes('ペーパー') || n.includes('ティッシュ')) {
            category = '日用品';
            unit = '箱';
            if (n.includes('ペーパー'))
                unit = '袋';
        }
        else if (n.includes('化粧水') || n.includes('乳液') || n.includes('クリーム')) {
            category = '化粧品';
            unit = '本';
        }
        else if (n.includes('掃除') || n.includes('クリーナー')) {
            category = '掃除用品';
            unit = '個';
        }
    }
    return { category, unit };
};
// ... (Sub components like QuantityController, ImagePreviewModal would go here)
// For brevity in this file generation, I will include them inline or simplified.
// In VS Code, please split these into src/components/ folder.
const QuantityController = ({ item, onUpdate }) => {
    const unitDef = UNIT_DEFINITIONS[item.unit] || UNIT_DEFINITIONS['個'];
    // ... (Logic same as prototype)
    // Re-implementing simplified version for display
    const handleInc = (e) => {
        e.stopPropagation();
        if (unitDef.type === 'level' && unitDef.options) {
            const next = [...unitDef.options].reverse().find(o => o.value > item.quantity);
            if (next)
                onUpdate(item.id, next.value);
        }
        else
            onUpdate(item.id, item.quantity + 1);
    };
    const handleDec = (e) => {
        e.stopPropagation();
        if (unitDef.type === 'level' && unitDef.options) {
            const prev = unitDef.options.find(o => o.value < item.quantity);
            if (prev)
                onUpdate(item.id, prev.value);
            else if (item.quantity > 0)
                onUpdate(item.id, 0);
        }
        else if (item.quantity > 0)
            onUpdate(item.id, item.quantity - 1);
    };
    let display = `${item.quantity}`;
    let sub = item.unit;
    let Icon = Battery;
    let color = "text-slate-700";
    if (unitDef.type === 'level' && unitDef.options) {
        const opt = unitDef.options.reduce((p, c) => Math.abs(c.value - item.quantity) < Math.abs(p.value - item.quantity) ? c : p);
        display = opt.label;
        sub = '';
        if (item.quantity === 0) {
            Icon = BatteryWarning;
            color = "text-slate-300";
        }
        else if (item.quantity <= 33) {
            Icon = BatteryLow;
            color = "text-rose-500";
        }
        else if (item.quantity <= 66) {
            Icon = BatteryMedium;
            color = "text-amber-500";
        }
        else {
            Icon = Battery;
            color = "text-emerald-500";
        }
    }
    return (_jsxs("div", { className: "flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200", children: [_jsx("button", { onClick: handleDec, className: "p-1.5 hover:bg-white rounded-md text-slate-500 hover:text-rose-500 disabled:opacity-30", disabled: item.quantity <= 0, children: _jsx(Minus, { size: 14 }) }), _jsx("div", { className: "px-1.5 min-w-[3.5rem] text-center flex flex-col items-center justify-center leading-none", children: unitDef.type === 'level' ? (_jsxs("div", { className: "flex flex-col items-center", children: [_jsx("span", { className: `text-[10px] font-bold ${color}`, children: display }), _jsx(Icon, { size: 12, className: color })] })) : (_jsxs(_Fragment, { children: [_jsx("span", { className: "font-bold text-slate-700 text-sm", children: display }), _jsx("span", { className: "text-[9px] text-slate-400", children: sub })] })) }), _jsx("button", { onClick: handleInc, className: "p-1.5 hover:bg-white rounded-md text-slate-500 hover:text-emerald-600 disabled:opacity-30", disabled: unitDef.type === 'level' && item.quantity >= 100, children: _jsx(Plus, { size: 14 }) })] }));
};
// Main App
export default function App() {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [items, setItems] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [currentLocation, setCurrentLocation] = useState(null);
    // Modal State
    const [formData, setFormData] = useState({});
    const [uploading, setUploading] = useState(false); // Upload loading state
    useEffect(() => {
        const initAuth = async () => {
            await signInAnonymously(auth);
        };
        initAuth();
        const unsub = onAuthStateChanged(auth, (u) => { setUser(u); setLoading(false); });
        return () => unsub();
    }, []);
    useEffect(() => {
        if (!user)
            return;
        const q = query(collection(db, 'artifacts', 'inventory-management-v1', 'public', 'data', 'inventory'));
        const unsub = onSnapshot(q, (snap) => {
            const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setItems(list.sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()));
        });
        return () => unsub();
    }, [user]);
    // Image Upload Logic
    const handleImageUpload = async (file) => {
        if (!user)
            throw new Error("No user");
        const blob = await compressImageToBlob(file);
        const path = `images/${user.uid}/${Date.now()}_${file.name}`;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, blob);
        const url = await getDownloadURL(storageRef);
        return { url, path };
    };
    const handleSave = async () => {
        if (!user)
            return;
        setUploading(true);
        try {
            let imageUrl = formData.image;
            let imagePath = formData.imagePath;
            // New image selected (as File object)
            if (formData.imageFile) {
                // If updating and there was an old image, delete it (optional, good for cleanup)
                if (editingItem?.imagePath) {
                    // await deleteObject(ref(storage, editingItem.imagePath)).catch(e => console.log("Old img delete fail", e)); 
                }
                const result = await handleImageUpload(formData.imageFile);
                imageUrl = result.url;
                imagePath = result.path;
            }
            else if (formData.image === null && editingItem?.imagePath) {
                // Image removed
                // await deleteObject(ref(storage, editingItem.imagePath)).catch(e => console.log("Img delete fail", e));
                imageUrl = null;
                imagePath = null;
            }
            const saveData = {
                ...formData,
                image: imageUrl ?? null,
                imagePath: imagePath ?? null,
                updatedBy: user.uid,
                location: currentLocation,
            };
            // Deep sanitize object to remove undefined and non-serializable values (e.g., File/Blob/custom File-like objects) before saving to Firestore
            const isFileLike = (v) => {
                if (!v || typeof v !== 'object')
                    return false;
                // Real File/Blob instances
                if (typeof Blob !== 'undefined' && v instanceof Blob)
                    return true;
                // Plain object that looks like a File (name/type/size)
                if ('name' in v && 'size' in v && 'type' in v && typeof v.name === 'string')
                    return true;
                return false;
            };
            const sanitizeForFirestore = (val) => {
                if (val === undefined)
                    return undefined;
                if (val === null)
                    return null;
                if (isFileLike(val))
                    return undefined; // drop File-like objects entirely
                if (typeof val !== 'object')
                    return val;
                if (Array.isArray(val)) {
                    const arr = val.map(sanitizeForFirestore).filter(v => v !== undefined);
                    return arr;
                }
                const out = {};
                for (const [k, v] of Object.entries(val)) {
                    // Explicitly drop any fields meant to be temporary file holders
                    if (k === 'imageFile' || k.endsWith('File'))
                        continue;
                    const sv = sanitizeForFirestore(v);
                    if (sv !== undefined && typeof sv !== 'function')
                        out[k] = sv;
                }
                return out;
            };
            const cleanedSaveData = sanitizeForFirestore(saveData);
            console.debug('Firestore save payload:', cleanedSaveData);
            try {
                if (editingItem) {
                    await updateDoc(doc(db, 'artifacts', 'inventory-management-v1', 'public', 'data', 'inventory', editingItem.id), cleanedSaveData);
                }
                else {
                    await addDoc(collection(db, 'artifacts', 'inventory-management-v1', 'public', 'data', 'inventory'), {
                        ...cleanedSaveData,
                        createdAt: Timestamp.now()
                    });
                }
                setIsModalOpen(false);
            }
            catch (err) {
                console.error('Save failed', err, { saveData, cleanedSaveData });
                throw err;
            }
        }
        catch (e) {
            console.error(e);
            alert("保存に失敗しました");
        }
        finally {
            setUploading(false);
        }
    };
    // ... (Other handlers like delete, restock are same as prototype but use 'inventory-management-v1' as appId)
    // Spinner, Image Preview Modal and ListItem components (from mock)
    const Spinner = () => (_jsx("div", { className: "animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500" }));
    const ImagePreviewModal = ({ isOpen, onClose, imageUrl, itemName }) => {
        if (!isOpen || !imageUrl)
            return null;
        return (_jsx("div", { className: "fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 backdrop-blur-sm", onClick: onClose, children: _jsxs("div", { className: "relative bg-white rounded-xl overflow-hidden max-w-lg w-full shadow-2xl", onClick: e => e.stopPropagation(), children: [_jsxs("div", { className: "p-4 border-b flex justify-between items-center bg-slate-50", children: [_jsxs("h3", { className: "font-bold text-slate-800 flex items-center gap-2", children: [_jsx(ImageIcon, { size: 18, className: "text-emerald-600" }), itemName] }), _jsx("button", { onClick: onClose, className: "p-1 hover:bg-slate-200 rounded-full transition-colors", children: _jsx(X, { size: 24, className: "text-slate-500" }) })] }), _jsx("div", { className: "p-2 bg-slate-900 flex justify-center", children: _jsx("img", { src: imageUrl, alt: itemName, className: "max-h-[60vh] object-contain rounded" }) })] }) }));
    };
    const ListItem = ({ item, onDelete, onEdit, onViewImage, onUpdateQuantity, onRestock }) => {
        const [expanded, setExpanded] = useState(false);
        const [showDelete, setShowDelete] = useState(false);
        const today = new Date();
        const expiry = new Date(item.expiryDate);
        const diffTime = expiry.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        let statusColor = "bg-emerald-100 text-emerald-700";
        let statusText = `あと${diffDays}日`;
        let isOutOfStock = item.quantity === 0;
        if (isOutOfStock) {
            statusColor = "bg-slate-200 text-slate-500";
            statusText = "在庫切れ";
        }
        else if (diffDays < 0) {
            statusColor = "bg-gray-100 text-gray-500";
            statusText = "期限切れ";
        }
        else if (diffDays <= 3) {
            statusColor = "bg-rose-100 text-rose-600 font-bold";
        }
        else if (diffDays <= 7) {
            statusColor = "bg-amber-100 text-amber-700";
        }
        const getCategoryColor = (cat) => {
            switch (cat) {
                case '冷蔵品': return 'bg-blue-400';
                case '冷凍品': return 'bg-cyan-400';
                case '野菜': return 'bg-green-400';
                case '肉・魚': return 'bg-red-400';
                case '洗剤': return 'bg-purple-400';
                case '日用品': return 'bg-orange-400';
                case '化粧品': return 'bg-pink-400';
                default: return 'bg-slate-300';
            }
        };
        // スワイプで削除ボタン表示
        const swipeHandlers = useSwipeable({
            onSwipedLeft: () => setShowDelete(true),
            onSwipedRight: () => setShowDelete(false),
            trackMouse: true,
        });
        return (_jsxs("div", { className: `relative bg-white border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors ${isOutOfStock ? 'bg-slate-50/60' : ''}`, ...swipeHandlers, onMouseLeave: () => setShowDelete(false), children: [_jsxs("div", { className: `flex items-center p-3 gap-3 cursor-pointer transition-transform duration-200 ${showDelete ? 'translate-x-[-80px]' : ''}`, onClick: () => setExpanded(!expanded), style: { transform: showDelete ? 'translateX(-80px)' : 'translateX(0)', transition: 'transform 0.2s' }, children: [_jsx("div", { className: `w-2 h-2 rounded-full flex-shrink-0 ${isOutOfStock ? 'bg-slate-300' : getCategoryColor(item.category)}` }), _jsxs("div", { className: `flex-1 min-w-0 ${isOutOfStock ? 'opacity-60' : ''}`, children: [_jsxs("div", { className: "flex justify-between items-start mb-1", children: [_jsx("h3", { className: "font-bold text-slate-800 text-sm truncate pr-2", children: item.name }), _jsx("span", { className: `flex-shrink-0 px-2 py-0.5 rounded text-[10px] whitespace-nowrap ${statusColor}`, children: statusText })] }), _jsx("div", { className: "flex items-center justify-between", children: _jsxs("div", { className: "flex items-center text-xs text-slate-400 gap-2", children: [_jsx("span", { children: item.category }), _jsx("span", { children: item.expiryDate.replace(/-/g, '/') })] }) })] }), _jsxs("div", { className: "flex items-center gap-2", children: [_jsx("div", { className: `${isOutOfStock ? 'opacity-50' : ''}`, onClick: e => e.stopPropagation(), children: _jsx(QuantityController, { item: item, onUpdate: onUpdateQuantity }) }), isOutOfStock && (_jsx("button", { onClick: (e) => { e.stopPropagation(); onRestock(item); }, className: "p-1.5 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors border border-emerald-100", children: _jsx(RefreshCw, { size: 16 }) })), _jsx("div", { className: "text-slate-300 pl-1", children: expanded ? _jsx(ChevronUp, { size: 16 }) : _jsx(ChevronDown, { size: 16 }) })] })] }), _jsx("div", { className: `absolute top-0 right-0 h-full flex items-center pr-4 transition-opacity duration-200 ${showDelete ? 'opacity-100' : 'opacity-0 pointer-events-none'}`, style: { zIndex: 2 }, children: _jsxs("button", { onClick: (e) => { e.stopPropagation(); onDelete(item.id); setShowDelete(false); }, className: "flex items-center gap-1 px-4 py-2 bg-rose-600 text-white rounded-lg text-xs shadow hover:bg-rose-700", children: [_jsx(Trash2, { size: 16 }), " \u524A\u9664"] }) }), expanded && (_jsxs("div", { className: "bg-slate-50 px-4 py-3 text-sm border-t border-slate-100", children: [_jsxs("div", { className: "flex flex-col gap-2 mb-3", children: [item.image && (_jsx("div", { className: "mb-2", children: _jsxs("button", { onClick: (e) => { e.stopPropagation(); onViewImage(item); }, className: "flex items-center gap-2 text-emerald-600 font-bold text-xs bg-white border border-emerald-100 py-2 px-3 rounded-lg shadow-sm hover:shadow", children: [_jsx(ImageIcon, { size: 16 }), " \u30D1\u30C3\u30B1\u30FC\u30B8\u5199\u771F\u3092\u78BA\u8A8D"] }) })), item.memo && (_jsxs("div", { className: "text-slate-600 text-xs bg-white p-2 rounded border border-slate-200", children: [_jsx("span", { className: "font-bold text-slate-400 mr-1", children: "MEMO:" }), item.memo] })), item.customFields?.map(f => (_jsxs("div", { className: "bg-white px-2 py-1 rounded border border-slate-200 text-xs flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: f.label }), _jsx("span", { className: "font-medium text-slate-700", children: f.value })] }, f.id))), _jsxs("div", { className: "text-xs text-slate-400 flex gap-4", children: [_jsxs("span", { children: ["\u8CFC\u5165: ", item.purchaseDate] }), _jsxs("span", { children: ["\u5358\u4F4D: ", UNIT_DEFINITIONS[item.unit]?.label || item.unit] })] })] }), _jsxs("div", { className: "flex justify-end gap-3 mt-2", children: [_jsxs("button", { onClick: (e) => { e.stopPropagation(); onEdit(item); }, className: "flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200", children: [_jsx(Edit2, { size: 14 }), " \u7DE8\u96C6"] }), _jsxs("button", { onClick: (e) => { e.stopPropagation(); onDelete(item.id); }, className: "flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200", children: [_jsx(Trash2, { size: 14 }), " \u524A\u9664"] })] })] }))] }));
    };
    // --- App rendering logic (mock UI integrated with Firebase actions) ---
    const [viewMode, setViewMode] = useState('inventory');
    // タブ順序
    const viewModes = ['inventory', 'expiring', 'out_of_stock'];
    const viewModeIndex = viewModes.indexOf(viewMode);
    // スワイプでタブ切り替え
    const swipeHandlers = useSwipeable({
        onSwipedLeft: () => {
            if (viewModeIndex < viewModes.length - 1)
                setViewMode(viewModes[viewModeIndex + 1]);
        },
        onSwipedRight: () => {
            if (viewModeIndex > 0)
                setViewMode(viewModes[viewModeIndex - 1]);
        },
        trackMouse: true,
    });
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [filterText, setFilterText] = useState('');
    const [viewingImageItem, setViewingImageItem] = useState(null);
    const imageInputRef = useRef(null);
    const categories = currentLocation === 'kitchen'
        ? ['冷蔵品', '冷凍品', '野菜', '肉・魚', '調味料', '飲料', '乾物', 'お菓子', '日用品', 'その他']
        : ['日用品', '洗剤', '化粧品', 'オーラルケア', 'ヘアケア', '掃除用品', 'その他'];
    const openAddModal = () => {
        const today = new Date().toISOString().split('T')[0];
        setEditingItem(null);
        setFormData({
            name: '', category: categories[0] || 'その他',
            purchaseDate: today, expiryDate: '',
            quantity: 1, unit: '個', memo: '',
            customFields: [], image: null, location: currentLocation
        });
        setIsModalOpen(true);
    };
    const openEditModal = (item) => {
        setEditingItem(item);
        setFormData({ ...item });
        setIsModalOpen(true);
    };
    const handleDeleteItem = async (id) => {
        if (confirm('削除しますか？')) {
            await deleteDoc(doc(db, 'artifacts', 'inventory-management-v1', 'public', 'data', 'inventory', id));
        }
    };
    const handleUpdateQuantity = async (id, q) => {
        await updateDoc(doc(db, 'artifacts', 'inventory-management-v1', 'public', 'data', 'inventory', id), { quantity: q });
    };
    const handleRestock = async (item) => {
        const isLevel = UNIT_DEFINITIONS[item.unit]?.type === 'level';
        const newQty = isLevel ? 100 : 1;
        await updateDoc(doc(db, 'artifacts', 'inventory-management-v1', 'public', 'data', 'inventory', item.id), { quantity: newQty, purchaseDate: new Date().toISOString().split('T')[0] });
    };
    const filteredItems = items.filter(item => {
        const itemLocation = item.location || 'kitchen';
        if (itemLocation !== currentLocation)
            return false;
        if (viewMode === 'inventory' && item.quantity === 0)
            return false;
        if (viewMode === 'out_of_stock' && item.quantity > 0)
            return false;
        if (viewMode === 'expiring') {
            if (item.quantity === 0)
                return false;
            const diffDays = Math.ceil((new Date(item.expiryDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays > 7)
                return false;
        }
        if (selectedCategory !== 'all' && item.category !== selectedCategory)
            return false;
        return item.name.toLowerCase().includes(filterText.toLowerCase()) || item.category.includes(filterText);
    });
    if (!currentLocation) {
        return (_jsxs("div", { className: "min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6", children: [_jsx("header", { className: "mb-6 text-center", children: _jsx("div", { className: "inline-flex items-center gap-3 justify-center", children: _jsx("div", { className: "flex items-center", children: _jsx(Logo, {}) }) }) }), _jsxs("div", { className: "grid gap-4 w-full max-w-sm", children: [_jsxs("button", { "aria-label": "\u30AD\u30C3\u30C1\u30F3", onClick: () => setCurrentLocation('kitchen'), className: "bg-white p-8 rounded-3xl shadow-lg ring-1 ring-rose-100 flex flex-col items-center hover:shadow-xl transition", children: [_jsx(Utensils, { size: 40, className: "text-rose-500 mb-2" }), _jsx("span", { className: "font-bold text-slate-700", children: "\u30AD\u30C3\u30C1\u30F3" })] }), _jsxs("button", { "aria-label": "\u6D17\u9762\u6240", onClick: () => setCurrentLocation('washroom'), className: "bg-white p-8 rounded-3xl shadow-lg ring-1 ring-indigo-100 flex flex-col items-center hover:shadow-xl transition", children: [_jsx(Droplet, { size: 40, className: "text-indigo-500 mb-2" }), _jsx("span", { className: "font-bold text-slate-700", children: "\u6D17\u9762\u6240" })] })] })] }));
    }
    return (_jsxs("div", { className: "min-h-screen bg-slate-50 pb-24 font-sans text-slate-800", children: [_jsxs("header", { className: "bg-white sticky top-0 z-20 shadow-sm px-4 py-3 safe-top", children: [_jsxs("div", { className: "max-w-3xl mx-auto flex justify-between items-center mb-2", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("button", { onClick: () => setCurrentLocation(null), className: "p-2 -ml-2 text-slate-500 hover:text-slate-700 rounded-full hover:bg-slate-100", children: _jsx(ArrowLeft, { size: 20 }) }), _jsx("div", { className: `${currentLocation === 'kitchen' ? 'bg-emerald-100' : 'bg-blue-100'} p-1.5 rounded-lg`, children: currentLocation === 'kitchen' ? _jsx(Utensils, { size: 20, className: "text-emerald-600" }) : _jsx(Droplet, { size: 20, className: "text-blue-600" }) }), _jsx("h1", { className: "font-bold text-lg tracking-tight", children: currentLocation === 'kitchen' ? 'キッチン' : '洗面所・浴室' })] }), _jsx("button", { onClick: () => setCurrentLocation(null), className: "text-slate-400 hover:text-slate-600 p-2", children: _jsx(Home, { size: 20 }) })] }), _jsxs("div", { className: "max-w-3xl mx-auto flex p-1 bg-slate-100 rounded-lg", children: [_jsx("button", { onClick: () => { setViewMode('inventory'); setSelectedCategory('all'); }, className: `flex-1 py-1.5 text-xs font-bold rounded-md transition-all ${viewMode === 'inventory' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`, children: "\u5728\u5EAB\u3042\u308A" }), _jsxs("button", { onClick: () => { setViewMode('expiring'); setSelectedCategory('all'); }, className: `flex-1 py-1.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1 ${viewMode === 'expiring' ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-500'}`, children: [_jsx(AlertTriangle, { size: 12 }), " \u671F\u9650\u76F4\u524D"] }), _jsxs("button", { onClick: () => { setViewMode('out_of_stock'); setSelectedCategory('all'); }, className: `flex-1 py-1.5 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1 ${viewMode === 'out_of_stock' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`, children: [_jsx(ShoppingCart, { size: 12 }), " \u5728\u5EAB\u5207\u308C"] })] })] }), _jsxs("main", { className: "max-w-3xl mx-auto p-4 space-y-4", ...swipeHandlers, children: [_jsxs("div", { className: "flex gap-2", children: [_jsxs("div", { className: "relative min-w-[120px]", children: [_jsx("div", { className: "absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none", children: _jsx(Filter, { size: 14, className: "text-slate-400" }) }), _jsxs("select", { value: selectedCategory, onChange: (e) => setSelectedCategory(e.target.value), className: "w-full pl-8 pr-8 py-2.5 bg-white border border-slate-200 rounded-lg shadow-sm focus:ring-2 focus:ring-emerald-500 outline-none text-xs appearance-none truncate font-medium", children: [_jsx("option", { value: "all", children: "\u5168\u30AB\u30C6\u30B4\u30EA" }), categories.map(cat => _jsx("option", { value: cat, children: cat }, cat))] }), _jsx("div", { className: "absolute inset-y-0 right-0 pr-2 flex items-center pointer-events-none", children: _jsx(ChevronDown, { size: 14, className: "text-slate-400" }) })] }), _jsxs("div", { className: "relative flex-1", children: [_jsx(Search, { className: "absolute left-3 top-1/2 -translate-y-1/2 text-slate-400", size: 16 }), _jsx("input", { type: "text", placeholder: "\u691C\u7D22...", value: filterText, onChange: (e) => setFilterText(e.target.value), className: "w-full pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg shadow-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all text-xs" })] })] }), _jsxs("div", { children: [_jsxs("div", { className: "flex justify-between items-end px-1 mb-2", children: [_jsxs("h2", { className: "font-bold text-slate-700 text-sm", children: [viewMode === 'inventory' && '在庫リスト', viewMode === 'expiring' && 'もうすぐ期限切れ', viewMode === 'out_of_stock' && '買わなきゃリスト'] }), _jsxs("span", { className: "text-xs text-slate-400", children: [filteredItems.length, "\u4EF6"] })] }), _jsx("div", { className: "bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden min-h-[300px]", children: filteredItems.length === 0 ? (_jsxs("div", { className: "text-center py-12 px-4 h-full flex flex-col items-center justify-center", children: [_jsx("div", { className: "bg-slate-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3", children: _jsx(Package, { size: 24, className: "text-slate-300" }) }), _jsx("p", { className: "text-slate-500 font-medium text-sm", children: "\u30A2\u30A4\u30C6\u30E0\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093" }), _jsx("p", { className: "text-slate-400 text-xs mt-1", children: "\u6761\u4EF6\u3092\u5909\u66F4\u3059\u308B\u304B\u3001\u8FFD\u52A0\u3057\u3066\u304F\u3060\u3055\u3044" })] })) : (_jsx("div", { className: "divide-y divide-slate-100", children: filteredItems.map(item => (_jsx(ListItem, { item: item, onDelete: handleDeleteItem, onEdit: openEditModal, onViewImage: setViewingImageItem, onUpdateQuantity: handleUpdateQuantity, onRestock: handleRestock }, item.id))) })) })] })] }), viewMode === 'inventory' && (_jsx("div", { className: "fixed bottom-6 right-6 z-30", children: _jsx("button", { onClick: openAddModal, className: `${currentLocation === 'kitchen' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'} text-white rounded-full p-4 shadow-xl hover:shadow-2xl hover:scale-105 transition-all flex items-center justify-center`, children: _jsx(Plus, { size: 24 }) }) })), isModalOpen && (_jsx("div", { className: "fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4", children: _jsxs("div", { className: "bg-white w-full max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto flex flex-col shadow-2xl", children: [_jsxs("div", { className: "sticky top-0 bg-white z-10 px-6 py-4 border-b flex justify-between items-center", children: [_jsx("h2", { className: "text-xl font-bold text-slate-800", children: editingItem ? 'アイテムを編集' : 'アイテムを追加' }), _jsx("button", { onClick: () => setIsModalOpen(false), className: "p-2 hover:bg-slate-100 rounded-full", children: _jsx(X, { size: 20, className: "text-slate-500" }) })] }), _jsxs("div", { className: "p-6 space-y-6", children: [_jsxs("div", { className: "border-2 border-dashed border-slate-300 rounded-lg p-4 text-center cursor-pointer hover:bg-slate-50 relative", children: [_jsx("input", { type: "file", accept: "image/*", className: "absolute inset-0 opacity-0", ref: imageInputRef, onChange: (e) => {
                                                if (e.target.files?.[0])
                                                    setFormData({ ...formData, imageFile: e.target.files[0] });
                                            } }), _jsx("div", { className: "flex flex-col items-center gap-2", children: formData.imageFile ? (_jsxs("div", { className: "text-emerald-600 font-bold flex items-center gap-2", children: [_jsx(ImageIcon, { size: 20 }), " \u753B\u50CF\u9078\u629E\u6E08\u307F"] })) : formData.image ? (_jsxs("div", { className: "relative", children: [_jsx("img", { src: formData.image, className: "h-20 rounded" }), _jsx("div", { className: "text-xs text-slate-400 mt-1", children: "\u30BF\u30C3\u30D7\u3057\u3066\u5909\u66F4" })] })) : (_jsxs("div", { className: "text-slate-400 flex flex-col items-center", children: [_jsx(Camera, { className: "mb-2", size: 24 }), "\u5199\u771F\u3092\u64AE\u308B / \u9078\u629E"] })) })] }), _jsxs("div", { className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-slate-700 mb-1", children: "\u5546\u54C1\u540D" }), _jsx("input", { type: "text", value: formData.name || '', onChange: (e) => setFormData({ ...formData, name: e.target.value }), onBlur: () => {
                                                        if (formData.name) {
                                                            const { category, unit } = guessCategoryAndUnit(formData.name, currentLocation);
                                                            setFormData((prev) => ({ ...prev, category: category || prev.category, unit: unit || prev.unit }));
                                                        }
                                                    }, placeholder: "\u4F8B: \u725B\u4E73", className: "w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" })] }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-slate-700 mb-1", children: "\u30AB\u30C6\u30B4\u30EA" }), _jsx("select", { value: formData.category, onChange: (e) => setFormData({ ...formData, category: e.target.value }), className: "w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none", children: categories.map(cat => _jsx("option", { value: cat, children: cat }, cat)) })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-slate-700 mb-1", children: "\u5358\u4F4D" }), _jsx("select", { value: formData.unit, onChange: (e) => {
                                                                const newUnit = e.target.value;
                                                                const isNewLevel = UNIT_DEFINITIONS[newUnit]?.type === 'level';
                                                                setFormData({ ...formData, unit: newUnit, quantity: isNewLevel ? 100 : 1 });
                                                            }, className: "w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none", children: Object.keys(UNIT_DEFINITIONS).map(key => _jsx("option", { value: key, children: UNIT_DEFINITIONS[key].label }, key)) })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-slate-700 mb-1", children: UNIT_DEFINITIONS[formData.unit]?.type === 'level' ? '現在の状態' : '数量' }), UNIT_DEFINITIONS[formData.unit]?.type === 'level' ? (_jsx("div", { className: "flex gap-2 overflow-x-auto pb-2 no-scrollbar", children: UNIT_DEFINITIONS['残量'].options?.map(opt => (_jsx("button", { onClick: () => setFormData({ ...formData, quantity: opt.value }), className: `flex-shrink-0 px-3 py-2 rounded-lg border text-sm font-bold transition-all ${formData.quantity === opt.value ? 'bg-emerald-100 border-emerald-500 text-emerald-700' : 'bg-white border-slate-200 text-slate-500'}`, children: opt.label }, opt.value))) })) : (_jsxs("div", { className: "flex items-center gap-3", children: [_jsx("button", { onClick: () => setFormData((prev) => ({ ...prev, quantity: Math.max(0, prev.quantity - 1) })), className: "p-2 bg-slate-100 rounded hover:bg-slate-200", children: _jsx(Minus, { size: 20 }) }), _jsx("input", { type: "number", min: "0", value: formData.quantity, onChange: (e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 0 }), className: "w-24 px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none text-center" }), _jsx("button", { onClick: () => setFormData((prev) => ({ ...prev, quantity: prev.quantity + 1 })), className: "p-2 bg-slate-100 rounded hover:bg-slate-200", children: _jsx(Plus, { size: 20 }) })] }))] }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-slate-700 mb-1", children: "\u8CFC\u5165\u65E5" }), _jsx("input", { type: "date", value: formData.purchaseDate, onChange: (e) => setFormData({ ...formData, purchaseDate: e.target.value }), className: "w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none text-sm" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-slate-700 mb-1", children: "\u8CDE\u5473\u671F\u9650" }), _jsx("input", { type: "date", value: formData.expiryDate, onChange: (e) => setFormData({ ...formData, expiryDate: e.target.value }), className: "w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none text-sm" })] })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium text-slate-700 mb-1", children: "\u30E1\u30E2" }), _jsx("textarea", { value: formData.memo, onChange: (e) => setFormData({ ...formData, memo: e.target.value }), placeholder: "\u4F8B: \u958B\u5C01\u6E08\u307F", rows: 2, className: "w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none resize-none" })] })] }), _jsx("div", { className: "p-6 border-t bg-slate-50 sticky bottom-0 rounded-b-2xl", children: _jsxs("button", { onClick: handleSave, disabled: uploading, className: "w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2", children: [_jsx(Save, { size: 20 }), " ", uploading ? '保存中...' : (editingItem ? '変更を保存' : 'リストに追加')] }) })] })] }) })), _jsx(ImagePreviewModal, { isOpen: !!viewingImageItem, onClose: () => setViewingImageItem(null), imageUrl: viewingImageItem?.image || null, itemName: viewingImageItem?.name || '' })] }));
}
