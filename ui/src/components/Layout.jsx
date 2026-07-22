import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from "@/lib/utils";
import { LayoutDashboard, Target, Play, Menu, ArrowDownUp, X, ChevronRight, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "@/components/mode-toggle";

const SidebarItem = ({ to, icon: Icon, children }) => {
    return (
        <NavLink
            to={to}
            className={({ isActive }) =>
                cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
                    isActive
                        ? "bg-secondary text-secondary-foreground shadow-sm font-semibold"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                )
            }
        >
            <Icon className="h-4 w-4" />
            {children}
        </NavLink>
    );
};

export default function Layout({ children }) {
    const [mobileOpen, setMobileOpen] = useState(false);
    const location = useLocation();

    const navigation = [
        { name: 'Scripts', to: '/', icon: LayoutDashboard },
        { name: 'Targets', to: '/targets', icon: Target },
        { name: 'Preview Tester', to: '/preview', icon: Play },
        { name: 'Data Transfer', to: '/data-transfer', icon: ArrowDownUp },
    ];

    const getBreadcrumbs = () => {
        const paths = location.pathname.split('/').filter(Boolean);
        if (paths.length === 0) return [{ name: 'Scripts', to: '/' }];
        
        return paths.map((path, index) => {
            const to = `/${paths.slice(0, index + 1).join('/')}`;
            const name = path.charAt(0).toUpperCase() + path.slice(1).replace(/-/g, ' ');
            return { name, to };
        });
    };

    return (
        <div className="grid min-h-screen w-full md:grid-cols-[220px_1fr] lg:grid-cols-[260px_1fr] bg-background text-foreground">
            {/* Sidebar for Desktop */}
            <div className="hidden border-r bg-card md:flex md:flex-col h-screen sticky top-0 text-card-foreground">
                <div className="flex h-14 items-center border-b px-6 lg:h-[60px] shrink-0 gap-2">
                    <NavLink to="/" className="flex items-center gap-2 font-bold text-lg tracking-tight">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                            <Zap className="h-4 w-4 animate-pulse" />
                        </div>
                        <span className="bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent">FLUX</span>
                    </NavLink>
                </div>
                <div className="flex-1 overflow-auto py-4">
                    <nav className="grid gap-1 px-4 text-sm font-medium">
                        {navigation.map((item) => (
                            <SidebarItem key={item.name} to={item.to} icon={item.icon}>
                                {item.name}
                            </SidebarItem>
                        ))}
                    </nav>
                </div>
                <div className="p-4 border-t text-xs text-muted-foreground text-center">
                    v0.1.1
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex flex-col min-h-screen">
                {/* Sticky Header */}
                <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-background/95 backdrop-blur px-4 lg:h-[60px] lg:px-6">
                    {/* Hamburger Button for Mobile */}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="md:hidden"
                        onClick={() => setMobileOpen(true)}
                    >
                        <Menu className="h-5 w-5" />
                        <span className="sr-only">Open Menu</span>
                    </Button>

                    {/* Breadcrumbs / Page Title */}
                    <nav className="flex items-center space-x-1.5 text-sm font-medium text-muted-foreground flex-1">
                        <NavLink to="/" className="hover:text-foreground transition-colors">
                            FLUX
                        </NavLink>
                        {getBreadcrumbs().map((crumb, idx) => (
                            <React.Fragment key={crumb.to}>
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                                <NavLink
                                    to={crumb.to}
                                    className={cn(
                                        "hover:text-foreground transition-colors",
                                        idx === getBreadcrumbs().length - 1 && "text-foreground font-semibold"
                                    )}
                                >
                                    {crumb.name}
                                </NavLink>
                            </React.Fragment>
                        ))}
                    </nav>

                    {/* Action Utilities (Theme Switcher) */}
                    <div className="flex items-center gap-2">
                        <ModeToggle />
                    </div>
                </header>

                <main className="flex-1 overflow-auto p-4 lg:p-6 bg-muted/20">
                    {children}
                </main>
            </div>

            {/* Mobile Navigation Drawer (Overlay & Panel) */}
            {mobileOpen && (
                <div className="fixed inset-0 z-50 flex md:hidden animate-in fade-in duration-200">
                    {/* Backdrop */}
                    <div 
                        className="fixed inset-0 bg-background/80 backdrop-blur-sm transition-opacity duration-300"
                        onClick={() => setMobileOpen(false)}
                    />
                    
                    {/* Panel */}
                    <div className="relative flex w-full max-w-xs flex-col bg-card p-6 text-card-foreground shadow-lg ring-1 ring-black/5 animate-in slide-in-from-left duration-300">
                        <div className="flex items-center justify-between mb-8">
                            <NavLink to="/" className="flex items-center gap-2 font-bold text-lg" onClick={() => setMobileOpen(false)}>
                                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                                    <Zap className="h-4 w-4" />
                                </div>
                                <span>FLUX</span>
                            </NavLink>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setMobileOpen(false)}
                            >
                                <X className="h-5 w-5" />
                                <span className="sr-only">Close Menu</span>
                            </Button>
                        </div>
                        
                        <nav className="grid gap-2 text-base font-medium">
                            {navigation.map((item) => (
                                <NavLink
                                    key={item.name}
                                    to={item.to}
                                    onClick={() => setMobileOpen(false)}
                                    className={({ isActive }) =>
                                        cn(
                                            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
                                            isActive
                                                ? "bg-secondary text-secondary-foreground shadow-sm font-semibold"
                                                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                        )
                                    }
                                >
                                    <item.icon className="h-4 w-4" />
                                    {item.name}
                                </NavLink>
                            ))}
                        </nav>
                        
                        <div className="mt-auto pt-6 text-center text-xs text-muted-foreground border-t">
                            v0.1.1
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
