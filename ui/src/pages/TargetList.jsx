import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, Globe } from "lucide-react";

function TargetList() {
    const [targets, setTargets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        loadTargets();
    }, []);

    const loadTargets = async () => {
        try {
            setLoading(true);
            const data = await api.fetchTargets();
            setTargets(data.targets || []);
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (id) => {
        try {
            setDeleting(true);
            setError(null);
            await api.deleteTarget(id);
            setDeleteConfirm(null);
            await loadTargets();
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
                    <h1 className="text-3xl font-bold tracking-tight">Proxy Targets</h1>
                    <p className="text-muted-foreground mt-2">
                        Manage target hosts with custom metadata
                    </p>
                </div>
                <Button onClick={() => navigate('/targets/create')}>
                    <Plus className="mr-2 h-4 w-4" /> Add New Target
                </Button>
            </div>

            {error && (
                <div className="bg-destructive/15 text-destructive p-4 rounded-md mb-6">
                    <strong>Error:</strong> {error}
                </div>
            )}

            {targets.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed rounded-lg">
                    <h3 className="text-lg font-medium">No targets configured</h3>
                    <p className="text-muted-foreground">Add your first proxy target to get started</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {targets.map((target) => (
                        <Card key={target.id} className="flex flex-col hover:border-primary/20 hover:shadow-md transition-all duration-200 bg-card text-card-foreground">
                            <CardHeader className="pb-3">
                                <div className="flex items-center gap-2.5">
                                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground shrink-0">
                                        <Globe className="h-4.5 w-4.5" />
                                    </div>
                                    <CardTitle className="text-lg font-semibold tracking-tight truncate">{target.nickname}</CardTitle>
                                </div>
                                <CardDescription className="font-mono text-xs mt-2 text-muted-foreground truncate bg-muted/30 px-2 py-1 rounded-sm">
                                    {target.baseUrl}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="flex-1 pb-3">
                                {target.tags && target.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mb-2.5">
                                        {target.tags.map(tag => (
                                            <Badge key={tag} variant="secondary" className="px-2 py-0.5 text-xs font-medium">
                                                {tag}
                                            </Badge>
                                        ))}
                                    </div>
                                )}
                                {target.metadata && Object.keys(target.metadata).length > 0 && (
                                    <div className="text-xs text-muted-foreground mt-2 border-t pt-2">
                                        <span className="font-semibold text-foreground">Metadata:</span> {Object.keys(target.metadata).join(', ')}
                                    </div>
                                )}
                            </CardContent>
                            <CardFooter className="flex justify-end gap-2 pt-3 border-t bg-muted/10">
                                <Button variant="outline" size="sm" onClick={() => navigate(`/targets/edit/${target.id}`)}>
                                    <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                                </Button>
                                <Button variant="destructive" size="sm" onClick={() => setDeleteConfirm(target)}>
                                    <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
                                </Button>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            )}

            {/* Delete Confirmation Modal */}
            <Dialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Confirm Delete</DialogTitle>
                        <DialogDescription>
                            Are you sure you want to delete <strong>{deleteConfirm?.nickname}</strong>? This action cannot be undone.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={() => handleDelete(deleteConfirm?.id)} disabled={deleting}>
                            {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            {deleting ? 'Deleting...' : 'Delete'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

export default TargetList;
