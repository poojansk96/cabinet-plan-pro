import { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, Send, X, Loader2, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import type { Project, Unit, Cabinet, Accessory, CountertopSection, CabinetType, Room, AccessoryType } from '@/types/project';

interface AIAction {
  action: string;
  [key: string]: any;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  actions?: AIAction[];
  status?: 'pending' | 'done' | 'error';
}

interface Props {
  project: Project;
  addUnit: (projectId: string, data: Omit<Unit, 'id' | 'cabinets' | 'accessories' | 'countertops'>) => Unit;
  updateUnit: (projectId: string, unitId: string, data: Partial<Unit>) => void;
  deleteUnit: (projectId: string, unitId: string) => void;
  clearUnits: (projectId: string) => void;
  addCabinet: (projectId: string, unitId: string, data: Omit<Cabinet, 'id'>) => Cabinet;
  updateCabinet: (projectId: string, unitId: string, cabinetId: string, data: Partial<Cabinet>) => void;
  deleteCabinet: (projectId: string, unitId: string, cabinetId: string) => void;
  addAccessory: (projectId: string, unitId: string, data: Omit<Accessory, 'id'>) => Accessory;
  deleteAccessory: (projectId: string, unitId: string, accId: string) => void;
  addCountertop: (projectId: string, unitId: string, data: Omit<CountertopSection, 'id'>) => CountertopSection;
  deleteCountertop: (projectId: string, unitId: string, ctId: string) => void;
  updateProject: (projectId: string, data: Partial<Project>) => void;
}

const EDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-project-command`;

function findUnit(project: Project, unitNumber: string): Unit | undefined {
  const norm = unitNumber.trim().toLowerCase();
  return project.units.find(u => u.unitNumber.trim().toLowerCase() === norm);
}

export default function AICommandButton({
  project, addUnit, updateUnit, deleteUnit, clearUnits,
  addCabinet, updateCabinet, deleteCabinet,
  addAccessory, deleteAccessory,
  addCountertop, deleteCountertop, updateProject,
}: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const executeActions = useCallback((actions: AIAction[]) => {
    const results: string[] = [];

    for (const act of actions) {
      try {
        switch (act.action) {
          case 'ADD_UNIT': {
            addUnit(project.id, {
              unitNumber: act.unitNumber || '',
              type: act.type || 'Other',
              bldg: act.bldg || '',
              floor: act.floor || '',
              notes: act.notes || '',
            });
            results.push(`✅ Added unit ${act.unitNumber}`);
            break;
          }
          case 'REMOVE_UNIT': {
            const unit = findUnit(project, act.unitNumber);
            if (unit) {
              deleteUnit(project.id, unit.id);
              results.push(`✅ Removed unit ${act.unitNumber}`);
            } else {
              results.push(`⚠️ Unit ${act.unitNumber} not found`);
            }
            break;
          }
          case 'UPDATE_UNIT': {
            const unit = findUnit(project, act.unitNumber);
            if (unit) {
              updateUnit(project.id, unit.id, act.updates || {});
              results.push(`✅ Updated unit ${act.unitNumber}`);
            } else {
              results.push(`⚠️ Unit ${act.unitNumber} not found`);
            }
            break;
          }
          case 'ADD_CABINET': {
            const unit = findUnit(project, act.unitNumber);
            if (unit) {
              addCabinet(project.id, unit.id, {
                sku: act.sku || '',
                type: (act.type as CabinetType) || 'Base',
                room: (act.room as Room) || 'Kitchen',
                quantity: act.quantity || 1,
                width: act.width || 0,
                height: act.height || 0,
                depth: act.depth || 0,
                notes: act.notes || '',
              });
              results.push(`✅ Added cabinet ${act.sku} to unit ${act.unitNumber}`);
            } else {
              results.push(`⚠️ Unit ${act.unitNumber} not found`);
            }
            break;
          }
          case 'REMOVE_CABINET': {
            const unit = findUnit(project, act.unitNumber);
            if (unit) {
              const cab = unit.cabinets.find(c =>
                c.sku.toLowerCase() === (act.sku || '').toLowerCase() &&
                (!act.room || c.room.toLowerCase() === act.room.toLowerCase())
              );
              if (cab) {
                deleteCabinet(project.id, unit.id, cab.id);
                results.push(`✅ Removed cabinet ${act.sku} from unit ${act.unitNumber}`);
              } else {
                results.push(`⚠️ Cabinet ${act.sku} not found in unit ${act.unitNumber}`);
              }
            } else {
              results.push(`⚠️ Unit ${act.unitNumber} not found`);
            }
            break;
          }
          case 'UPDATE_CABINET': {
            const unit = findUnit(project, act.unitNumber);
            if (unit) {
              const cab = unit.cabinets.find(c =>
                c.sku.toLowerCase() === (act.sku || '').toLowerCase() &&
                (!act.room || c.room.toLowerCase() === act.room.toLowerCase())
              );
              if (cab) {
                updateCabinet(project.id, unit.id, cab.id, act.updates || {});
                results.push(`✅ Updated cabinet ${act.sku} in unit ${act.unitNumber}`);
              } else {
                results.push(`⚠️ Cabinet ${act.sku} not found in unit ${act.unitNumber}`);
              }
            } else {
              results.push(`⚠️ Unit ${act.unitNumber} not found`);
            }
            break;
          }
          case 'ADD_ACCESSORY': {
            const unit = findUnit(project, act.unitNumber);
            if (unit) {
              addAccessory(project.id, unit.id, {
                type: (act.type as AccessoryType) || 'Other',
                description: act.description || '',
                quantity: act.quantity || 1,
                width: act.width,
                height: act.height,
                linearFeet: act.linearFeet,
              });
              results.push(`✅ Added accessory to unit ${act.unitNumber}`);
            } else {
              results.push(`⚠️ Unit ${act.unitNumber} not found`);
            }
            break;
          }
          case 'REMOVE_ACCESSORY': {
            const unit = findUnit(project, act.unitNumber);
            if (unit) {
              const acc = unit.accessories.find(a =>
                a.description.toLowerCase().includes((act.description || '').toLowerCase())
              );
              if (acc) {
                deleteAccessory(project.id, unit.id, acc.id);
                results.push(`✅ Removed accessory from unit ${act.unitNumber}`);
              } else {
                results.push(`⚠️ Accessory not found in unit ${act.unitNumber}`);
              }
            } else {
              results.push(`⚠️ Unit ${act.unitNumber} not found`);
            }
            break;
          }
          case 'ADD_COUNTERTOP': {
            const unit = findUnit(project, act.unitNumber);
            if (unit) {
              addCountertop(project.id, unit.id, {
                label: act.label || 'Section',
                length: act.length || 0,
                depth: act.depth || 25.5,
                isIsland: act.isIsland || false,
                addWaste: true,
                splashHeight: act.splashHeight,
              });
              results.push(`✅ Added countertop to unit ${act.unitNumber}`);
            } else {
              results.push(`⚠️ Unit ${act.unitNumber} not found`);
            }
            break;
          }
          case 'REMOVE_COUNTERTOP': {
            const unit = findUnit(project, act.unitNumber);
            if (unit) {
              const ct = unit.countertops.find(c =>
                c.label.toLowerCase().includes((act.label || '').toLowerCase())
              );
              if (ct) {
                deleteCountertop(project.id, unit.id, ct.id);
                results.push(`✅ Removed countertop from unit ${act.unitNumber}`);
              } else {
                results.push(`⚠️ Countertop not found in unit ${act.unitNumber}`);
              }
            } else {
              results.push(`⚠️ Unit ${act.unitNumber} not found`);
            }
            break;
          }
          case 'UPDATE_PROJECT': {
            updateProject(project.id, act.updates || {});
            results.push(`✅ Updated project`);
            break;
          }
          case 'CLEAR_UNITS': {
            clearUnits(project.id);
            results.push(`✅ Cleared all units`);
            break;
          }
          case 'MESSAGE': {
            // Messages are displayed in the chat
            break;
          }
          default: {
            results.push(`⚠️ Unknown action: ${act.action}`);
          }
        }
      } catch (err) {
        results.push(`❌ Error executing ${act.action}: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    }

    return results;
  }, [project, addUnit, updateUnit, deleteUnit, clearUnits, addCabinet, updateCabinet, deleteCabinet, addAccessory, deleteAccessory, addCountertop, deleteCountertop, updateProject]);

  const handleSubmit = async () => {
    const cmd = input.trim();
    if (!cmd || loading) return;
    setInput('');

    const userMsg: ChatMessage = { role: 'user', content: cmd };
    const pendingMsg: ChatMessage = { role: 'assistant', content: '', status: 'pending' };
    setMessages(prev => [...prev, userMsg, pendingMsg]);
    setLoading(true);

    try {
      const resp = await fetch(EDGE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          command: cmd,
          projectState: {
            name: project.name,
            units: project.units.map(u => ({
              unitNumber: u.unitNumber,
              type: u.type,
              bldg: u.bldg,
              floor: u.floor,
              cabinets: u.cabinets,
              accessories: u.accessories,
              countertops: u.countertops,
            })),
          },
        }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errData.error || `Error ${resp.status}`);
      }

      const data = await resp.json();
      const actions: AIAction[] = data.actions || [];

      // Execute non-MESSAGE actions
      const execResults = executeActions(actions);

      // Collect MESSAGE text
      const msgTexts = actions
        .filter(a => a.action === 'MESSAGE')
        .map(a => a.text)
        .filter(Boolean);

      const fullResponse = [...execResults, ...msgTexts].join('\n');

      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: fullResponse || 'Done!',
          actions,
          status: 'done',
        };
        return updated;
      });

      if (execResults.some(r => r.startsWith('✅'))) {
        toast.success('AI actions executed successfully');
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          role: 'assistant',
          content: `❌ ${errMsg}`,
          status: 'error',
        };
        return updated;
      });
      toast.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const NUDGE_MESSAGES = [
    "Need help? Ask me anything! ✨",
    "I can add units, cabinets & more 🚀",
    "Try saying: 'Add unit 101' 💡",
    "Let me handle the boring stuff 😎",
    "Got a question? I'm here! 🙋",
    "Type a command, I'll do the rest ⚡",
  ];

  const [showNudge, setShowNudge] = useState(false);
  const [nudgeMessage] = useState(() => NUDGE_MESSAGES[Math.floor(Math.random() * NUDGE_MESSAGES.length)]);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const showTimer = setTimeout(() => setShowNudge(true), 3000);
    nudgeTimerRef.current = setTimeout(() => setShowNudge(false), 8000);
    return () => {
      clearTimeout(showTimer);
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    };
  }, []);

  if (!open) {
    return (
      <div className="fixed bottom-20 right-6 z-50 flex items-center gap-2">
        {/* Nudge tooltip */}
        <div
          className={`bg-card border border-border shadow-lg rounded-xl px-3 py-2 text-xs font-medium text-foreground whitespace-nowrap transition-all duration-500 ${
            showNudge ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4 pointer-events-none'
          }`}
        >
          <span>{nudgeMessage}</span>
          <div className="absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 bg-card border-r border-t border-border rotate-45" />
        </div>

        <button
          onClick={() => { setOpen(true); setShowNudge(false); }}
          className="w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all hover:scale-105 flex items-center justify-center animate-pulse"
          title="AI Command"
        >
          <Bot size={24} />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-20 right-6 z-50 w-96 max-h-[520px] flex flex-col rounded-2xl border bg-card shadow-2xl overflow-hidden" style={{ borderColor: 'hsl(var(--border))' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-primary text-primary-foreground">
        <div className="flex items-center gap-2">
          <Bot size={18} />
          <span className="font-semibold text-sm">AI Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMessages([])} className="p-1 rounded hover:bg-primary-foreground/20 text-xs opacity-70 hover:opacity-100" title="Clear chat">
            Clear
          </button>
          <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-primary-foreground/20">
            <ChevronDown size={16} />
          </button>
        </div>
      </div>

      {/* Chat body */}
      <div className="flex-1 overflow-auto p-3 space-y-3 min-h-[200px] max-h-[380px]">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground text-xs py-8 space-y-2">
            <Bot size={32} className="mx-auto opacity-40" />
            <p>Tell me what to do!</p>
            <div className="text-[11px] space-y-1 text-left max-w-[280px] mx-auto">
              <p className="font-medium">Examples:</p>
              <p className="italic">"Add unit 101, Studio, Building A, Floor 1"</p>
              <p className="italic">"Remove unit 205"</p>
              <p className="italic">"Add cabinet W3030 to unit 101 kitchen"</p>
              <p className="italic">"Change unit 101 type to 2BHK"</p>
              <p className="italic">"Clear all units"</p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`rounded-xl px-3 py-2 max-w-[85%] text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : msg.status === 'error'
                  ? 'bg-destructive/10 text-destructive border border-destructive/20'
                  : 'bg-muted text-foreground'
              }`}
            >
              {msg.status === 'pending' ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" />
                  <span>Thinking...</span>
                </div>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="border-t p-3 flex gap-2" style={{ borderColor: 'hsl(var(--border))' }}>
        <Input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSubmit()}
          placeholder="Type a command..."
          disabled={loading}
          className="flex-1 text-sm"
        />
        <Button size="icon" onClick={handleSubmit} disabled={loading || !input.trim()} className="shrink-0">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </Button>
      </div>
    </div>
  );
}
