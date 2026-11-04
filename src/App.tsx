function App() {
  return (
    <main className="min-h-screen bg-paper px-5 py-8 text-ink sm:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-5xl flex-col">
        <header className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-brand-600 text-xl text-white shadow-soft" aria-hidden="true">✓</div>
          <div>
            <p className="text-lg font-bold tracking-tight">Mi Compra</p>
            <p className="text-xs text-slate-500">La compra de casa, en orden</p>
          </div>
        </header>

        <section className="my-auto max-w-2xl py-16">
          <span className="inline-flex rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold text-brand-700">Proyecto en construcción</span>
          <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
            Comprar mejor empieza por organizarse.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
            Estamos preparando un espacio compartido para la lista familiar, las preferencias de cada producto y la comparación de precios con datos verificables.
          </p>
          <div className="mt-9 flex flex-wrap gap-3 text-sm">
            <span className="rounded-xl border border-brand-100 bg-white px-4 py-3 shadow-sm">Lista familiar compartida</span>
            <span className="rounded-xl border border-brand-100 bg-white px-4 py-3 shadow-sm">Preferencias inteligentes</span>
            <span className="rounded-xl border border-brand-100 bg-white px-4 py-3 shadow-sm">Precios contrastados</span>
          </div>
        </section>

        <footer className="border-t border-slate-200 pt-5 text-xs text-slate-500">
          Mi Compra · Versión inicial 0.1.0
        </footer>
      </div>
    </main>
  )
}

export default App
