import React, { useState, useEffect, useRef } from 'react';
import { useSwipeable } from 'react-swipeable';
import { auth, db, storage } from './firebase'; // firebase.tsからインポート
import Logo from './components/Logo';
import { 
  onAuthStateChanged, 
  signInAnonymously, 
  User,
  signOut
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  onSnapshot, 
  deleteDoc, 
  doc, 
  updateDoc, 
  Timestamp,
} from 'firebase/firestore';
import { 
  ref, 
  uploadBytes, 
  getDownloadURL, 
  deleteObject 
} from 'firebase/storage';
import { 
  Camera, Plus, Trash2, Edit2, Save, X, Search, 
  MoreVertical, ChevronDown, ChevronUp, LogOut, ScanLine, 
  Refrigerator, AlertTriangle, Package, ArrowLeft, 
  Image as ImageIcon, Utensils, Droplet, Home, Filter, 
  RefreshCw, ShoppingCart, Minus, Battery, 
  BatteryMedium, BatteryLow, BatteryWarning, Carrot, Fish, Soup, CupSoda, Candy, SprayCan, Smile, Tag, Snowflake
} from 'lucide-react';

// --- Types ---
type LocationType = 'kitchen' | 'washroom';
type ViewMode = 'inventory' | 'expiring' | 'out_of_stock';
type UnitType = 'count' | 'level';

interface UnitDefinition {
  label: string;
  type: UnitType;
  options?: { value: number; label: string }[];
}

const UNIT_DEFINITIONS: Record<string, UnitDefinition> = {
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

interface CustomField {
  id: string;
  label: string;
  value: string;
}

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  purchaseDate: string;
  expiryDate: string;
  memo: string;
  quantity: number;
  unit: string;
  customFields: CustomField[];
  image?: string | null; // URL
  imagePath?: string | null; // Storage path for deletion
  location?: LocationType;
  createdAt: any;
}

// --- Utilities ---
// 画像をリサイズ・圧縮してBlobを返す
const compressImageToBlob = (file: File): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1000; // 長辺1000pxに制限
        const scaleSize = MAX_WIDTH / Math.max(img.width, MAX_WIDTH);
        canvas.width = img.width * scaleSize;
        canvas.height = img.height * scaleSize;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Canvas to Blob failed'));
        }, 'image/jpeg', 0.7); // 70% quality JPEG
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

// Guess category & unit heuristics used when user types product name
const guessCategoryAndUnit = (name: string, location: LocationType | null) => {
  const n = (name || '').toString();
  let category = '';
  let unit = '';
  const loc = location || 'kitchen';

  if (loc === 'kitchen') {
    if (n.includes('牛') || n.includes('豚') || n.includes('鶏') || n.includes('肉') || n.includes('ハム') || n.includes('ソーセージ') || n.includes('魚')) {
      category = '肉・魚'; unit = 'パック';
    } else if (n.includes('キャベツ') || n.includes('レタス') || n.includes('トマト') || n.includes('野菜')) {
      category = '野菜'; unit = '個';
      if (n.includes('キャベツ') || n.includes('レタス')) unit = '玉';
    } else if (n.includes('牛乳') || n.includes('ジュース') || n.includes('茶') || n.includes('水') || n.includes('酒')) {
      category = '飲料'; unit = '本';
    } else if (n.includes('醤油') || n.includes('ソース') || n.includes('マヨネーズ') || n.includes('ケチャップ') || n.includes('油') || n.includes('ドレッシング')) {
      category = '調味料'; unit = '本'; 
    } else if (n.includes('パスタ') || n.includes('麺') || n.includes('そば') || n.includes('うどん')) {
      category = '乾物'; unit = '袋'; 
      if (n.includes('そば') || (n.includes('うどん') && !n.includes('カップ'))) unit = '束';
    } else if (n.includes('納豆') || n.includes('豆腐') || n.includes('ヨーグルト') || n.includes('チーズ') || n.includes('卵')) {
      category = '冷蔵品'; unit = 'パック';
      if (n.includes('チーズ')) unit = '個';
    } else if (n.includes('アイス') || n.includes('冷凍')) {
      category = '冷凍品'; unit = '個';
    } else if (n.includes('チョコ') || n.includes('クッキー') || n.includes('菓子')) {
      category = 'お菓子'; unit = '袋'; 
    } else if (n.includes('米')) {
       category = '乾物'; unit = '袋';
    }
  } else {
    if (n.includes('洗剤') || n.includes('漂白剤') || n.includes('柔軟剤')) {
      category = '洗剤'; unit = '本'; 
      if (n.includes('詰替')) unit = '袋';
    } else if (n.includes('シャンプー') || n.includes('リンス') || n.includes('コンディショナー')) {
      category = 'ヘアケア'; unit = '本';
      if (n.includes('詰替')) unit = '袋';
    } else if (n.includes('ソープ') || n.includes('石鹸')) {
      category = '日用品'; unit = '個';
      if (n.includes('ソープ') && !n.includes('石鹸')) unit = '本';
      if (n.includes('詰替')) unit = '袋';
    } else if (n.includes('歯磨き') || n.includes('歯ブラシ')) {
      category = 'オーラルケア'; unit = '本'; 
    } else if (n.includes('ペーパー') || n.includes('ティッシュ')) {
      category = '日用品'; unit = '箱'; 
      if (n.includes('ペーパー')) unit = '袋';
    } else if (n.includes('化粧水') || n.includes('乳液') || n.includes('クリーム')) {
      category = '化粧品'; unit = '本';
    } else if (n.includes('掃除') || n.includes('クリーナー')) {
      category = '掃除用品'; unit = '個';
    }
  }

  return { category, unit };
};

// ... (Sub components like QuantityController, ImagePreviewModal would go here)
// For brevity in this file generation, I will include them inline or simplified.
// In VS Code, please split these into src/components/ folder.

const QuantityController = ({ item, onUpdate }: { item: InventoryItem, onUpdate: (id: string, qty: number) => void }) => {
  const unitDef = UNIT_DEFINITIONS[item.unit] || UNIT_DEFINITIONS['個'];
  // ... (Logic same as prototype)
  // Re-implementing simplified version for display
  const handleInc = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (unitDef.type === 'level' && unitDef.options) {
      const next = [...unitDef.options].reverse().find(o => o.value > item.quantity);
      if(next) onUpdate(item.id, next.value);
    } else onUpdate(item.id, item.quantity + 1);
  };
  const handleDec = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (unitDef.type === 'level' && unitDef.options) {
      const prev = unitDef.options.find(o => o.value < item.quantity);
      if(prev) onUpdate(item.id, prev.value);
      else if (item.quantity > 0) onUpdate(item.id, 0);
    } else if (item.quantity > 0) onUpdate(item.id, item.quantity - 1);
  };

  let display = `${item.quantity}`;
  let sub = item.unit;
  let Icon = Battery;
  let color = "text-slate-700";

  if (unitDef.type === 'level' && unitDef.options) {
    const opt = unitDef.options.reduce((p, c) => Math.abs(c.value - item.quantity) < Math.abs(p.value - item.quantity) ? c : p);
    display = opt.label;
    sub = '';
    if (item.quantity === 0) { Icon = BatteryWarning; color = "text-slate-300"; }
    else if (item.quantity <= 33) { Icon = BatteryLow; color = "text-rose-500"; }
    else if (item.quantity <= 66) { Icon = BatteryMedium; color = "text-amber-500"; }
    else { Icon = Battery; color = "text-emerald-500"; }
  }

  return (
    <div className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200">
      <button onClick={handleDec} className="p-1.5 hover:bg-white rounded-md text-slate-500 hover:text-rose-500 disabled:opacity-30" disabled={item.quantity <= 0}><Minus size={14} /></button>
      <div className="px-1.5 min-w-[3.5rem] text-center flex flex-col items-center justify-center leading-none">
        {unitDef.type === 'level' ? (
          <div className="flex flex-col items-center"><span className={`text-[10px] font-bold ${color}`}>{display}</span><Icon size={12} className={color} /></div>
        ) : (
          <><span className="font-bold text-slate-700 text-sm">{display}</span><span className="text-[9px] text-slate-400">{sub}</span></>
        )}
      </div>
      <button onClick={handleInc} className="p-1.5 hover:bg-white rounded-md text-slate-500 hover:text-emerald-600 disabled:opacity-30" disabled={unitDef.type === 'level' && item.quantity >= 100}><Plus size={14} /></button>
    </div>
  );
};

// Main App
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [currentLocation, setCurrentLocation] = useState<LocationType | null>(null);
  // 検索窓の拡大状態
  const [searchFocused, setSearchFocused] = useState(false);
  
  // Modal State
  const [formData, setFormData] = useState<any>({});
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
    if (!user) return;
    const q = query(collection(db, 'artifacts', 'inventory-management-v1', 'public', 'data', 'inventory'));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as InventoryItem[];
      setItems(list.sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()));
    });
    return () => unsub();
  }, [user]);

  // Image Upload Logic
  const handleImageUpload = async (file: File): Promise<{url: string, path: string}> => {
    if (!user) throw new Error("No user");
    const blob = await compressImageToBlob(file);
    const path = `images/${user.uid}/${Date.now()}_${file.name}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, blob);
    const url = await getDownloadURL(storageRef);
    return { url, path };
  };

  const handleSave = async () => {
    if (!user) return;
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
      } else if (formData.image === null && editingItem?.imagePath) {
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
      const isFileLike = (v: any) => {
        if (!v || typeof v !== 'object') return false;
        // Real File/Blob instances
        if (typeof Blob !== 'undefined' && v instanceof Blob) return true;
        // Plain object that looks like a File (name/type/size)
        if ('name' in v && 'size' in v && 'type' in v && typeof v.name === 'string') return true;
        return false;
      };

      const sanitizeForFirestore = (val: any): any => {
        if (val === undefined) return undefined;
        if (val === null) return null;
        if (isFileLike(val)) return undefined; // drop File-like objects entirely
        if (typeof val !== 'object') return val;
        if (Array.isArray(val)) {
          const arr = val.map(sanitizeForFirestore).filter(v => v !== undefined);
          return arr;
        }
        const out: any = {};
        for (const [k, v] of Object.entries(val)) {
          // Explicitly drop any fields meant to be temporary file holders
          if (k === 'imageFile' || k.endsWith('File')) continue;
          const sv = sanitizeForFirestore(v);
          if (sv !== undefined && typeof sv !== 'function') out[k] = sv;
        }
        return out;
      };

      const cleanedSaveData = sanitizeForFirestore(saveData);
      console.debug('Firestore save payload:', cleanedSaveData);

      try {
        if (editingItem) {
          await updateDoc(doc(db, 'artifacts', 'inventory-management-v1', 'public', 'data', 'inventory', editingItem.id), cleanedSaveData);
        } else {
          await addDoc(collection(db, 'artifacts', 'inventory-management-v1', 'public', 'data', 'inventory'), {
            ...cleanedSaveData,
            createdAt: Timestamp.now()
          });
        }
        setIsModalOpen(false);
      } catch (err) {
        console.error('Save failed', err, { saveData, cleanedSaveData });
        throw err;
      }
    } catch (e) {
      console.error(e);
      alert("保存に失敗しました");
    } finally {
      setUploading(false);
    }
  };

  // ... (Other handlers like delete, restock are same as prototype but use 'inventory-management-v1' as appId)

  // Spinner, Image Preview Modal and ListItem components (from mock)
  const Spinner = () => (
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
  );

  const ImagePreviewModal = ({ isOpen, onClose, imageUrl, itemName }: { isOpen: boolean, onClose: () => void, imageUrl: string | null, itemName: string }) => {
    if (!isOpen || !imageUrl) return null;
    return (
      <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
        <div className="relative bg-white rounded-xl overflow-hidden max-w-lg w-full shadow-2xl" onClick={e => e.stopPropagation()}>
          <div className="p-4 border-b flex justify-between items-center bg-slate-50">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              <ImageIcon size={18} className="text-emerald-600" />
              {itemName}
            </h3>
            <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full transition-colors"><X size={24} className="text-slate-500" /></button>
          </div>
          <div className="p-2 bg-slate-900 flex justify-center">
             <img src={imageUrl} alt={itemName} className="max-h-[60vh] object-contain rounded" />
          </div>
        </div>
      </div>
    );
  };

  const ListItem = ({ 
    item, onDelete, onEdit, onViewImage, onUpdateQuantity, onRestock 
  }: { 
    item: InventoryItem, 
    onDelete: (id: string) => void, 
    onEdit: (item: InventoryItem) => void, 
    onViewImage: (item: InventoryItem) => void,
    onUpdateQuantity: (id: string, qty: number) => void,
    onRestock: (item: InventoryItem) => void
  }) => {
    const [expanded, setExpanded] = useState(false);
    const [showDelete, setShowDelete] = useState(false);
    const today = new Date();
    let statusColor = "bg-emerald-100 text-emerald-700";
    let statusText = "";
    let isOutOfStock = item.quantity === 0;
    let diffDays: number | null = null;
    if (!item.expiryDate) {
      statusText = "期限設定なし";
      statusColor = "bg-slate-100 text-slate-400";
    } else {
      const expiry = new Date(item.expiryDate);
      const diffTime = expiry.getTime() - today.getTime();
      diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      statusText = `あと${diffDays}日`;
      if (isOutOfStock) {
        statusColor = "bg-slate-200 text-slate-500"; statusText = "在庫切れ";
      } else if (diffDays < 0) {
        statusColor = "bg-gray-100 text-gray-500"; statusText = "期限切れ";
      } else if (diffDays <= 3) {
        statusColor = "bg-rose-100 text-rose-600 font-bold";
      } else if (diffDays <= 7) {
        statusColor = "bg-amber-100 text-amber-700";
      }
    }

    const getCategoryColor = (cat: string) => {
      switch(cat) {
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

    // スワイプ削除廃止
    return (
      <div className={`relative bg-white border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors ${isOutOfStock ? 'bg-slate-50/60' : ''}`}
      >
        <div className={`flex items-center p-3 gap-3 cursor-pointer transition-transform duration-200`}
          onClick={() => setExpanded(!expanded)}
        >
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isOutOfStock ? 'bg-slate-300' : getCategoryColor(item.category)}`} />
          <div className={`flex-1 min-w-0 ${isOutOfStock ? 'opacity-60' : ''}`}> 
            <div className="flex justify-between items-start mb-1">
              <h3 className="font-bold text-slate-800 text-sm truncate pr-2">{item.name}</h3>
              <span className={`flex-shrink-0 px-2 py-0.5 rounded text-[10px] whitespace-nowrap ${statusColor}`}>{statusText}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center text-xs text-slate-400 gap-2">
                 <span>{item.category}</span>
                 <span>{item.expiryDate ? item.expiryDate.replace(/-/g, '/') : '期限設定なし'}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`${isOutOfStock ? 'opacity-50' : ''}`} onClick={e => e.stopPropagation()}>
              <QuantityController item={item} onUpdate={onUpdateQuantity} />
            </div>
            {isOutOfStock && (
               <button onClick={(e) => { e.stopPropagation(); onRestock(item); }} className="p-1.5 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors border border-emerald-100"><RefreshCw size={16} /></button>
            )}
            <div className="text-slate-300 pl-1">{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</div>
          </div>
        </div>
        {/* スワイプで出現する削除ボタン */}
        <div className={`absolute top-0 right-0 h-full flex items-center pr-4 transition-opacity duration-200 ${showDelete ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          style={{ zIndex: 2 }}
        >
          <button onClick={(e) => { e.stopPropagation(); onDelete(item.id); setShowDelete(false); }} className="flex items-center gap-1 px-4 py-2 bg-rose-600 text-white rounded-lg text-xs shadow hover:bg-rose-700"><Trash2 size={16} /> 削除</button>
        </div>
        {expanded && (
          <div className="bg-slate-50 px-4 py-3 text-sm border-t border-slate-100">
            <div className="flex flex-col gap-2 mb-3">
               {item.image && (
                 <div className="mb-2">
                   <button onClick={(e) => { e.stopPropagation(); onViewImage(item); }} className="flex items-center gap-2 text-emerald-600 font-bold text-xs bg-white border border-emerald-100 py-2 px-3 rounded-lg shadow-sm hover:shadow">
                      <ImageIcon size={16} /> パッケージ写真を確認
                    </button>
                 </div>
               )}
               {item.memo && (<div className="text-slate-600 text-xs bg-white p-2 rounded border border-slate-200"><span className="font-bold text-slate-400 mr-1">MEMO:</span>{item.memo}</div>)}
               {item.customFields?.map(f => (
                 <div key={f.id} className="bg-white px-2 py-1 rounded border border-slate-200 text-xs flex justify-between"><span className="text-slate-400">{f.label}</span><span className="font-medium text-slate-700">{f.value}</span></div>
               ))}
               <div className="text-xs text-slate-400 flex gap-4"><span>購入: {item.purchaseDate}</span><span>単位: {UNIT_DEFINITIONS[item.unit]?.label || item.unit}</span></div>
            </div>
            <div className="flex justify-end gap-3 mt-2">
              <button onClick={(e) => { e.stopPropagation(); onEdit(item); }} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200"><Edit2 size={14} /> 編集</button>
              <button onClick={(e) => { e.stopPropagation(); onDelete(item.id); }} className="flex items-center gap-1 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200"><Trash2 size={14} /> 削除</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // --- App rendering logic (mock UI integrated with Firebase actions) ---

  const [viewMode, setViewMode] = useState<ViewMode>('inventory');
  // タブ順序
  const viewModes: ViewMode[] = ['inventory', 'expiring', 'out_of_stock'];
  const viewModeIndex = viewModes.indexOf(viewMode);

  // スワイプでタブ切り替え
  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => {
      if (viewModeIndex < viewModes.length - 1) setViewMode(viewModes[viewModeIndex + 1]);
    },
    onSwipedRight: () => {
      if (viewModeIndex > 0) setViewMode(viewModes[viewModeIndex - 1]);
    },
    trackMouse: true,
  });
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [filterText, setFilterText] = useState('');
  const [viewingImageItem, setViewingImageItem] = useState<InventoryItem | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // カテゴリ追加機能
  const defaultCategories = currentLocation === 'kitchen'
    ? ['冷蔵品', '冷凍品', '野菜', '肉・魚', '調味料', '飲料', '乾物', 'お菓子', '日用品', 'その他']
    : ['日用品', '洗剤', '化粧品', 'オーラルケア', 'ヘアケア', '掃除用品', 'その他'];

  // カテゴリアイコン・色マップ
  const categoryMeta: Record<string, { color: string, icon: JSX.Element }> = {
    '冷蔵品': { color: 'bg-blue-400', icon: <Refrigerator size={14} className="text-blue-500" /> },
    '冷凍品': { color: 'bg-cyan-400', icon: <Snowflake size={14} className="text-cyan-500" /> },
    '野菜': { color: 'bg-green-400', icon: <Carrot size={14} className="text-green-500" /> },
    '肉・魚': { color: 'bg-red-400', icon: <Fish size={14} className="text-red-500" /> },
    '調味料': { color: 'bg-amber-400', icon: <Soup size={14} className="text-amber-500" /> },
    '飲料': { color: 'bg-indigo-400', icon: <CupSoda size={14} className="text-indigo-500" /> },
    '乾物': { color: 'bg-yellow-400', icon: <Package size={14} className="text-yellow-500" /> },
    'お菓子': { color: 'bg-pink-400', icon: <Candy size={14} className="text-pink-500" /> },
    '日用品': { color: 'bg-orange-400', icon: <Tag size={14} className="text-orange-500" /> },
    '洗剤': { color: 'bg-purple-400', icon: <SprayCan size={14} className="text-purple-500" /> },
    '化粧品': { color: 'bg-pink-300', icon: <Smile size={14} className="text-pink-400" /> },
    'オーラルケア': { color: 'bg-teal-400', icon: <Smile size={14} className="text-teal-500" /> },
    'ヘアケア': { color: 'bg-lime-400', icon: <Smile size={14} className="text-lime-500" /> },
    '掃除用品': { color: 'bg-gray-400', icon: <SprayCan size={14} className="text-gray-500" /> },
    'その他': { color: 'bg-slate-300', icon: <Tag size={14} className="text-slate-400" /> },
  };

  const getCategoryColor = (cat: string) => categoryMeta[cat]?.color || 'bg-slate-300';
  const getCategoryIcon = (cat: string) => categoryMeta[cat]?.icon || <Tag size={14} className="text-slate-400" />;
  const [categories, setCategories] = useState<string[]>(defaultCategories);
  const [newCategory, setNewCategory] = useState('');

  // currentLocationが変わったらカテゴリリストも初期化
  useEffect(() => {
    setCategories(defaultCategories);
  }, [currentLocation]);

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

  const openEditModal = (item: InventoryItem) => {
    setEditingItem(item);
    setFormData({ ...item });
    setIsModalOpen(true);
  };

  const handleDeleteItem = async (id: string) => {
    if (confirm('削除しますか？')) {
      await deleteDoc(doc(db, 'artifacts', 'inventory-management-v1', 'public', 'data', 'inventory', id));
    }
  };

  const handleUpdateQuantity = async (id: string, q: number) => {
    await updateDoc(doc(db, 'artifacts', 'inventory-management-v1', 'public', 'data', 'inventory', id), { quantity: q });
  };

  const handleRestock = async (item: InventoryItem) => {
    const isLevel = UNIT_DEFINITIONS[item.unit]?.type === 'level';
    const newQty = isLevel ? 100 : 1;
    await updateDoc(doc(db, 'artifacts', 'inventory-management-v1', 'public', 'data', 'inventory', item.id), { quantity: newQty, purchaseDate: new Date().toISOString().split('T')[0] });
  };

  const filteredItems = items.filter(item => {
    const itemLocation = item.location || 'kitchen';
    if (itemLocation !== currentLocation) return false;
    if (viewMode === 'inventory' && item.quantity === 0) return false;
    if (viewMode === 'out_of_stock' && item.quantity > 0) return false;
    if (viewMode === 'expiring') {
      if (item.quantity === 0) return false;
      if (!item.expiryDate) return false;
      const diffDays = Math.ceil((new Date(item.expiryDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays > 7) return false;
    }
    if (selectedCategory !== 'all' && item.category !== selectedCategory) return false;
    return item.name.toLowerCase().includes(filterText.toLowerCase()) || item.category.includes(filterText);
  });

  if (!currentLocation) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <header className="mb-6 text-center">
          <div className="inline-flex items-center gap-3 justify-center">
            <div className="flex items-center">
              <Logo />
            </div>
          </div>
        </header>

        <div className="grid gap-4 w-full max-w-sm">
          <button aria-label="キッチン" onClick={() => setCurrentLocation('kitchen')} className="bg-white p-8 rounded-3xl shadow-lg ring-1 ring-rose-100 flex flex-col items-center hover:shadow-xl transition">
            <Utensils size={40} className="text-rose-500 mb-2"/>
            <span className="font-bold text-slate-700">キッチン</span>
          </button>
          <button aria-label="洗面所" onClick={() => setCurrentLocation('washroom')} className="bg-white p-8 rounded-3xl shadow-lg ring-1 ring-indigo-100 flex flex-col items-center hover:shadow-xl transition">
            <Droplet size={40} className="text-indigo-500 mb-2"/>
            <span className="font-bold text-slate-700">洗面所</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24 font-sans text-slate-800">
      {/* Header */}
      <header className="bg-white sticky top-0 z-20 shadow-sm px-4 py-3 safe-top">
        <div className="max-w-3xl mx-auto flex justify-between items-center mb-2">
          <div className="flex items-center gap-2">
            <button onClick={() => setCurrentLocation(null)} className="p-2 -ml-2 text-slate-500 hover:text-slate-700 rounded-full hover:bg-slate-100"><ArrowLeft size={20} /></button>
            <div className={`${currentLocation === 'kitchen' ? 'bg-emerald-100' : 'bg-blue-100'} p-1.5 rounded-lg`}>
              {currentLocation === 'kitchen' ? <Utensils size={20} className="text-emerald-600" /> : <Droplet size={20} className="text-blue-600" />}
            </div>
            <h1 className="font-bold text-lg tracking-tight">{currentLocation === 'kitchen' ? 'キッチン' : '洗面所・浴室'}</h1>
          </div>
          <button onClick={() => setCurrentLocation(null)} className="text-slate-400 hover:text-slate-600 p-2"><Home size={20} /></button>
        </div>
        {/* タブUI: Xのタブ風デザイン */}
        <div className="max-w-3xl mx-auto flex border-b-2 border-slate-200 mb-2" {...swipeHandlers}>
          <button
            onClick={() => { setViewMode('inventory'); setSelectedCategory('all'); }}
            className={`flex-1 py-2 text-sm font-bold text-center border-b-4 transition-all
              ${viewMode === 'inventory' ? 'border-emerald-500 text-emerald-700 bg-white shadow' : 'border-transparent text-slate-400 bg-slate-50 hover:bg-slate-100'}`}
            style={{ borderRadius: '12px 12px 0 0' }}
          >
            在庫あり
          </button>
          <button
            onClick={() => { setViewMode('expiring'); setSelectedCategory('all'); }}
            className={`flex-1 py-2 text-sm font-bold text-center border-b-4 transition-all flex items-center justify-center gap-1
              ${viewMode === 'expiring' ? 'border-rose-500 text-rose-600 bg-white shadow' : 'border-transparent text-slate-400 bg-slate-50 hover:bg-slate-100'}`}
            style={{ borderRadius: '12px 12px 0 0' }}
          >
            <AlertTriangle size={14} /> 期限直前
          </button>
          <button
            onClick={() => { setViewMode('out_of_stock'); setSelectedCategory('all'); }}
            className={`flex-1 py-2 text-sm font-bold text-center border-b-4 transition-all flex items-center justify-center gap-1
              ${viewMode === 'out_of_stock' ? 'border-slate-800 text-slate-800 bg-white shadow' : 'border-transparent text-slate-400 bg-slate-50 hover:bg-slate-100'}`}
            style={{ borderRadius: '12px 12px 0 0' }}
          >
            <ShoppingCart size={14} /> 在庫切れ
          </button>
        </div>
      </header>

      {/* Main Content */}
      {/* タブUIで切り替え（スワイプ廃止） */}
      <main className="max-w-3xl mx-auto p-4 space-y-4">
        <div className="flex gap-2">
          {/* カテゴリフィルター */}
          <div className="relative min-w-[140px]">
            <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none">{getCategoryIcon(selectedCategory !== 'all' ? selectedCategory : 'その他')}</div>
            <select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className="w-full pl-8 pr-8 py-2.5 bg-white border border-slate-200 rounded-lg shadow-sm focus:ring-2 focus:ring-emerald-500 outline-none text-xs appearance-none truncate font-medium">
              <option value="all">全カテゴリ</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <div className="absolute inset-y-0 right-0 pr-2 flex items-center pointer-events-none"><ChevronDown size={14} className="text-slate-400" /></div>
            {/* カテゴリ追加UI */}
            <div className="flex mt-2 gap-1">
              <input
                type="text"
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
                placeholder="カテゴリ追加"
                className="flex-1 px-2 py-1 border border-slate-200 rounded text-xs"
                maxLength={12}
              />
              <button
                className="px-2 py-1 bg-emerald-500 text-white text-xs rounded hover:bg-emerald-600 disabled:bg-slate-200 disabled:text-slate-400"
                disabled={!newCategory.trim() || categories.includes(newCategory.trim())}
                onClick={() => {
                  const cat = newCategory.trim();
                  if (cat && !categories.includes(cat)) {
                    setCategories([...categories, cat]);
                    setNewCategory('');
                  }
                }}
              >追加</button>
            </div>
          </div>
          {/* 検索 */}
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-2 flex items-center pointer-events-none"><Search size={16} className="text-slate-400" /></div>
            <input
              type="text"
              placeholder="検索..."
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className={`w-full pl-8 pr-4 py-2.5 bg-white border border-slate-200 rounded-lg shadow-sm focus:ring-2 focus:ring-emerald-500 outline-none transition-all text-xs ${searchFocused ? 'scale-110 z-10 shadow-2xl' : ''}`}
              style={{ position: 'relative' }}
            />
          </div>
          // 検索窓の拡大状態
          const [searchFocused, setSearchFocused] = useState(false);
        </div>

        <div>
          <div className="flex justify-between items-end px-1 mb-2">
            <h2 className="font-bold text-slate-700 text-sm">
              {viewMode === 'inventory' && '在庫リスト'}
              {viewMode === 'expiring' && 'もうすぐ期限切れ'}
              {viewMode === 'out_of_stock' && '買わなきゃリスト'}
            </h2>
            <span className="text-xs text-slate-400">{filteredItems.length}件</span>
          </div>
          
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden min-h-[300px]">
            {filteredItems.length === 0 ? (
              <div className="text-center py-12 px-4 h-full flex flex-col items-center justify-center">
                <div className="bg-slate-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3"><Package size={24} className="text-slate-300" /></div>
                <p className="text-slate-500 font-medium text-sm">アイテムが見つかりません</p>
                <p className="text-slate-400 text-xs mt-1">条件を変更するか、追加してください</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {filteredItems.map(item => (
                  <ListItem key={item.id} item={item} onDelete={handleDeleteItem} onEdit={openEditModal} onViewImage={setViewingImageItem} onUpdateQuantity={handleUpdateQuantity} onRestock={handleRestock} />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* FAB */}
      {viewMode === 'inventory' && (
        <div className="fixed bottom-6 right-6 z-30">
          <button onClick={openAddModal} className={`${currentLocation === 'kitchen' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'} text-white rounded-full p-4 shadow-xl hover:shadow-2xl hover:scale-105 transition-all flex items-center justify-center`}><Plus size={24} /></button>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white w-full max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto flex flex-col shadow-2xl">
            <div className="sticky top-0 bg-white z-10 px-6 py-4 border-b flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-800">{editingItem ? 'アイテムを編集' : 'アイテムを追加'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full"><X size={20} className="text-slate-500" /></button>
            </div>
            <div className="p-6 space-y-6">
              <div className="border-2 border-dashed border-slate-300 rounded-lg p-4 text-center cursor-pointer hover:bg-slate-50 relative">
                <input type="file" accept="image/*" className="absolute inset-0 opacity-0" ref={imageInputRef} onChange={(e) => {
                  if(e.target.files?.[0]) setFormData({...formData, imageFile: e.target.files[0]});
                }} />
                <div className="flex flex-col items-center gap-2">
                  {formData.imageFile ? (
                    <div className="text-emerald-600 font-bold flex items-center gap-2"><ImageIcon size={20}/> 画像選択済み</div>
                  ) : formData.image ? (
                    <div className="relative"><img src={formData.image} className="h-20 rounded" /><div className="text-xs text-slate-400 mt-1">タップして変更</div></div>
                  ) : (
                    <div className="text-slate-400 flex flex-col items-center"><Camera className="mb-2" size={24}/>写真を撮る / 選択</div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">商品名</label>
                  <input type="text" value={formData.name || ''} onChange={(e) => setFormData({...formData, name: e.target.value})} onBlur={() => {
                    if (formData.name) {
                      const { category, unit } = guessCategoryAndUnit(formData.name, currentLocation);
                      setFormData((prev: any) => ({ ...prev, category: category || prev.category, unit: unit || prev.unit }));
                    }
                  }} placeholder="例: 牛乳" className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">カテゴリ</label>
                    <select value={formData.category} onChange={(e) => setFormData({...formData, category: e.target.value})} className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none">
                      {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                    {/* カテゴリ追加UI（モーダル用） */}
                    <div className="flex mt-2 gap-1">
                      <input
                        type="text"
                        value={newCategory}
                        onChange={e => setNewCategory(e.target.value)}
                        placeholder="カテゴリ追加"
                        className="flex-1 px-2 py-1 border border-slate-200 rounded text-xs"
                        maxLength={12}
                      />
                      <button
                        className="px-2 py-1 bg-emerald-500 text-white text-xs rounded hover:bg-emerald-600 disabled:bg-slate-200 disabled:text-slate-400"
                        disabled={!newCategory.trim() || categories.includes(newCategory.trim())}
                        onClick={() => {
                          const cat = newCategory.trim();
                          if (cat && !categories.includes(cat)) {
                            setCategories([...categories, cat]);
                            setNewCategory('');
                            setFormData((prev: any) => ({ ...prev, category: cat }));
                          }
                        }}
                      >追加</button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">単位</label>
                    <select value={formData.unit} onChange={(e) => {
                      const newUnit = e.target.value;
                      const isNewLevel = UNIT_DEFINITIONS[newUnit]?.type === 'level';
                      setFormData({ ...formData, unit: newUnit, quantity: isNewLevel ? 100 : 1 });
                    }} className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none">
                      {Object.keys(UNIT_DEFINITIONS).map(key => <option key={key} value={key}>{UNIT_DEFINITIONS[key].label}</option>)}
                    </select>
                  </div>
                </div>
                
                {/* Quantity Input */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{UNIT_DEFINITIONS[formData.unit]?.type === 'level' ? '現在の状態' : '数量'}</label>
                  {UNIT_DEFINITIONS[formData.unit]?.type === 'level' ? (
                     <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                       {UNIT_DEFINITIONS['残量'].options?.map(opt => (
                         <button key={opt.value} onClick={() => setFormData({...formData, quantity: opt.value})} className={`flex-shrink-0 px-3 py-2 rounded-lg border text-sm font-bold transition-all ${formData.quantity === opt.value ? 'bg-emerald-100 border-emerald-500 text-emerald-700' : 'bg-white border-slate-200 text-slate-500'}`}>{opt.label}</button>
                       ))}
                     </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button onClick={() => setFormData((prev: any) => ({...prev, quantity: Math.max(0, prev.quantity - 1)}))} className="p-2 bg-slate-100 rounded hover:bg-slate-200"><Minus size={20} /></button>
                      <input type="number" min="0" value={formData.quantity} onChange={(e) => setFormData({...formData, quantity: parseInt(e.target.value) || 0})} className="w-24 px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none text-center" />
                      <button onClick={() => setFormData((prev: any) => ({...prev, quantity: prev.quantity + 1}))} className="p-2 bg-slate-100 rounded hover:bg-slate-200"><Plus size={20} /></button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">購入日</label><input type="date" value={formData.purchaseDate} onChange={(e) => setFormData({...formData, purchaseDate: e.target.value})} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none text-sm" /></div>
                  <div><label className="block text-sm font-medium text-slate-700 mb-1">賞味期限</label><input type="date" value={formData.expiryDate} onChange={(e) => setFormData({...formData, expiryDate: e.target.value})} className="w-full px-3 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none text-sm" /></div>
                </div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">メモ</label><textarea value={formData.memo} onChange={(e) => setFormData({...formData, memo: e.target.value})} placeholder="例: 開封済み" rows={2} className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none resize-none" /></div>
              </div>
              <div className="p-6 border-t bg-slate-50 sticky bottom-0 rounded-b-2xl">
                <button onClick={handleSave} disabled={uploading} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-xl shadow-lg transition-all flex items-center justify-center gap-2"><Save size={20} /> {uploading ? '保存中...' : (editingItem ? '変更を保存' : 'リストに追加')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ImagePreviewModal isOpen={!!viewingImageItem} onClose={() => setViewingImageItem(null)} imageUrl={viewingImageItem?.image || null} itemName={viewingImageItem?.name || ''} />
    </div>
  );
}