import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import './index.css'
import Dashboard from './pages/Dashboard'
import Project from './pages/Project'
import Viewer from './pages/Viewer'
function Header() {
  return (
    <header className="sticky top-0 z-40 bg-gradient-to-r from-violet-600 via-indigo-600 to-sky-600 text-white shadow">
      <div className="mx-auto max-w-6xl px-4 py-3 flex justify-between items-center">
        <Link to="/" className="flex items-center gap-2 hover:opacity-90 transition">
          <img src="/hazelnut.svg" alt="Hazelnut" className="w-6 h-6" />
          <span className="font-bold text-xl tracking-tight">HazelnutPilot AI — by Vaidehi Kulkarni</span>
        </Link>
        <nav className="flex gap-5 text-white/90">
          <Link to="/" className="hover:text-white transition">Dashboard</Link>
        </nav>
      </div>
    </header>
  )
}
function App() {
  return (
    <div className="min-h-screen bg-slate-50">
      <Header />
      <main className="mx-auto max-w-6xl p-4">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/project/:id" element={<Project />} />
          <Route path="/viewer/:token" element={<Viewer />} />
        </Routes>
      </main>
    </div>
  )
}
createRoot(document.getElementById('root')).render(
  <React.StrictMode><BrowserRouter><App/></BrowserRouter></React.StrictMode>
)