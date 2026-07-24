import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, FileCode, ShieldAlert } from "lucide-react";

function ScriptList() {
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [requireScriptMatch, setRequireScriptMatch] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadScriptsAndConfig();
  }, []);

  const loadScriptsAndConfig = async () => {
    try {
      setLoading(true);
      const [scriptData, configData] = await Promise.all([
        api.fetchScripts(),
        api.getConfig().catch(() => ({ requireScriptMatch: false }))
      ]);

      if (configData && configData.requireScriptMatch !== undefined) {
        setRequireScriptMatch(configData.requireScriptMatch === true);
      }

      const scriptsWithMeta = await Promise.all(
        scriptData.map(async (scriptObj) => {
          const scriptName = scriptObj.name || scriptObj;
          try {
            const details = await api.getScript(scriptName);
            return {
              name: scriptName,
              tags: details.metadata?.tags || [],
              description: details.metadata?.description || ''
            };
          } catch (e) {
            return { name: scriptName, tags: [], description: '' };
          }
        })
      );

      setScripts(scriptsWithMeta);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleRequireScriptMatch = async (checked) => {
    try {
      setSavingConfig(true);
      setRequireScriptMatch(checked);
      await api.updateConfig({ requireScriptMatch: checked });
    } catch (err) {
      setError(`Failed to update setting: ${err.message}`);
      setRequireScriptMatch(!checked); // Revert on failure
    } finally {
      setSavingConfig(false);
    }
  };

  const handleDelete = async (name) => {
    try {
      setDeleting(true);
      setError(null);
      await api.deleteScript(name);
      setDeleteConfirm(null);
      await new Promise(resolve => setTimeout(resolve, 100));
      await loadScriptsAndConfig();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 max-w-7xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Transformation Scripts</h1>
          <p className="text-muted-foreground mt-2">
            Manage and edit your request transformation logic
          </p>
        </div>
        <Button onClick={() => navigate('/create')}>
          <Plus className="mr-2 h-4 w-4" /> Create New Script
        </Button>
      </div>

      {error && (
        <div className="bg-destructive/15 text-destructive p-4 rounded-md mb-6">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Global Setting: Require Script Match */}
      <Card className="mb-8 border-border bg-card">
        <CardContent className="py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-medium">
              <ShieldAlert className="h-4.5 w-4.5 text-primary" />
              <span>Strict Script Matching</span>
              {requireScriptMatch && (
                <Badge variant="default" className="text-[10px] px-1.5 py-0">Active</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground max-w-2xl">
              When enabled, incoming requests whose path does not match any script will be completely dropped and ignored (not forwarded to any target host).
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-muted-foreground font-medium">
              {requireScriptMatch ? 'Strict Mode Enabled' : 'Allow Unmatched'}
            </span>
            <Switch
              checked={requireScriptMatch}
              onCheckedChange={handleToggleRequireScriptMatch}
              disabled={savingConfig}
            />
          </div>
        </CardContent>
      </Card>

      {scripts.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed rounded-lg">
          <h3 className="text-lg font-medium">No scripts found</h3>
          <p className="text-muted-foreground">Create your first transformation script to get started</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {scripts.map((script) => (
            <Card key={script.name} className="flex flex-col hover:border-primary/20 hover:shadow-md transition-all duration-200 bg-card text-card-foreground">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground shrink-0">
                    <FileCode className="h-4.5 w-4.5" />
                  </div>
                  <CardTitle className="text-lg font-semibold tracking-tight truncate">{script.name}</CardTitle>
                </div>
                {script.description && (
                  <CardDescription className="line-clamp-2 mt-2 text-sm text-muted-foreground">
                    {script.description}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="flex-1 pb-3">
                 {script.tags && script.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {script.tags.map(tag => (
                      <Badge key={tag} variant="secondary" className="px-2 py-0.5 text-xs font-medium">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
              <CardFooter className="flex justify-end gap-2 pt-3 border-t bg-muted/10">
                <Button variant="outline" size="sm" onClick={() => navigate(`/edit/${script.name}`)}>
                  <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setDeleteConfirm(script.name)}>
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Delete</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deleteConfirm}</strong>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => handleDelete(deleteConfirm)} disabled={deleting}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ScriptList;
